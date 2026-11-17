import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { reduce } from "../shared/reduce";
import { allEvents, ALEX, as, count, SAM, uid } from "./helpers";

const alex = as(ALEX);
const sam = as(SAM);

describe("each mutation writes exactly one correct event", () => {
  it("covers every event type with before and after values", async () => {
    const task = uid();
    const item = uid();
    const note = uid();
    const file = uid();

    // [who, type, payload, expected event.task_id, expected payload.before, expected payload.after]
    const steps: Array<[typeof alex, string, Record<string, unknown>, string | null, string | null, object | null, object]> = [
      [alex, "task.created", { task_id: task, title: "Draft plan", description: "first" }, task, task, null,
        { title: "Draft plan", description: "first", owner_email: ALEX, due_date: null, priority: "normal" }],
      [sam, "task.updated", { task_id: task, fields: { title: "Draft plan v2", priority: "high", due_date: "2026-12-01" } }, task, task,
        { title: "Draft plan", priority: "normal", due_date: null },
        { title: "Draft plan v2", priority: "high", due_date: "2026-12-01" }],
      [sam, "task.reassigned", { task_id: task, owner_email: SAM }, task, task, { owner_email: ALEX }, { owner_email: SAM }],
      [alex, "task.archived", { task_id: task }, task, task, { archived_at: null }, { archived_at: "$now" }],
      [alex, "task.restored", { task_id: task }, task, task, { archived_at: "$prev" }, { archived_at: null }],
      [alex, "item.added", { task_id: task, item_id: item, text: "Collect numbers", position: "a0" }, task, item, null,
        { text: "Collect numbers", position: "a0" }],
      [sam, "item.edited", { item_id: item, text: "Collect the numbers" }, task, item, { text: "Collect numbers" }, { text: "Collect the numbers" }],
      [sam, "item.ticked", { item_id: item }, task, item, { done: 0 }, { done: 1 }],
      [alex, "item.unticked", { item_id: item }, task, item, { done: 1 }, { done: 0 }],
      [alex, "item.moved", { item_id: item, position: "b0" }, task, item, { position: "a0" }, { position: "b0" }],
      [alex, "item.removed", { item_id: item }, task, item, { removed_at: null }, { removed_at: "$now" }],
      [sam, "note.added", { task_id: task, note_id: note, body: "Sent to finance" }, task, note, null, { body: "Sent to finance" }],
      [alex, "attachment.added", { task_id: task, attachment_id: file, name: "plan.pdf", mime: "application/pdf", size: 1234 }, task, file, null,
        { name: "plan.pdf", mime: "application/pdf", size: 1234 }],
      [alex, "attachment.removed", { attachment_id: file }, task, file, { removed_at: null }, { removed_at: "$now" }],
      [sam, "task.completed", { task_id: task }, task, task, { completed_at: null }, { completed_at: "$now" }],
      [alex, "task.reopened", { task_id: task }, task, task, { completed_at: "$prev" }, { completed_at: null }],
      [alex, "user.named", { name: "Alex" }, null, ALEX, { name: null }, { name: "Alex" }],
    ];

    let previousNow: string | null = null;
    for (const [who, type, payload, taskId, entityId, before, after] of steps) {
      const eventsBefore = await count("events");
      const mutationId = uid();
      const clientAt = "2026-11-17T09:30:00.000+05:30";
      const res = await who.mutate(type, payload, { id: mutationId, client_at: clientAt });
      expect(res.status, `${type}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(await count("events")).toBe(eventsBefore + 1);

      const e = res.body.event;
      expect(res.body.replayed).toBe(false);
      expect(e.type).toBe(type);
      expect(e.task_id).toBe(taskId);
      expect(e.actor_email).toBe(who.email);
      expect(e.mutation_id).toBe(mutationId);
      expect(e.client_at).toBe("2026-11-17T04:00:00.000Z"); // normalised to UTC
      expect(e.server_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

      const resolve = (v: unknown) => (v === "$now" ? e.server_at : v === "$prev" ? previousNow : v);
      const expand = (o: object | null) => (o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolve(v)])));
      expect(e.payload).toEqual({ id: entityId, before: expand(before), after: expand(after) });

      if (type === "task.archived" || type === "task.completed") previousNow = e.server_at;
    }

    // Actor name is recorded as it was at the time: Alex named himself on the last step only.
    const events = await allEvents();
    expect(events.at(-1)!.actor_name).toBe(null);
    const later = await alex.mutate("note.added", { task_id: task, note_id: uid(), body: "After naming" });
    expect(later.body.event.actor_name).toBe("Alex");
  });
});

describe("replay", () => {
  it("returns the original event and changes nothing", async () => {
    const task = uid();
    const create = { id: uid(), client_at: new Date().toISOString() };
    const first = await alex.mutate("task.created", { task_id: task, title: "Once" }, create);
    const eventsAfterFirst = await count("events");

    const second = await alex.mutate("task.created", { task_id: task, title: "Once" }, create);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.event).toEqual(first.body.event);
    expect(await count("events")).toBe(eventsAfterFirst);
    expect(await count("tasks")).toBe(1);

    // An edit replayed after a later edit must not undo the later edit.
    const edit = { id: uid(), client_at: new Date().toISOString() };
    await alex.mutate("task.updated", { task_id: task, fields: { title: "Twice" } }, edit);
    await sam.mutate("task.updated", { task_id: task, fields: { title: "Thrice" } });
    const again = await alex.mutate("task.updated", { task_id: task, fields: { title: "Twice" } }, edit);
    expect(again.body.replayed).toBe(true);
    const row = await env.DB.prepare("SELECT title FROM tasks WHERE id = ?").bind(task).first<{ title: string }>();
    expect(row!.title).toBe("Thrice");
  });

  it("is safe when the same mutation arrives twice at once", async () => {
    const task = uid();
    const create = { id: uid(), client_at: new Date().toISOString() };
    const [a, b] = await Promise.all([
      alex.mutate("task.created", { task_id: task, title: "Race" }, create),
      alex.mutate("task.created", { task_id: task, title: "Race" }, create),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.event.seq).toBe(b.body.event.seq);
    expect(await count("events")).toBe(1);
    expect(await count("tasks")).toBe(1);
  });
});

describe("conflicts resolve without errors", () => {
  it("completing a task the other person archived is accepted and both writes stay in history", async () => {
    const task = uid();
    await alex.mutate("task.created", { task_id: task, title: "Contested" });
    await alex.mutate("task.archived", { task_id: task });
    const res = await sam.mutate("task.completed", { task_id: task });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT completed_at, archived_at FROM tasks WHERE id = ?").bind(task).first<any>();
    expect(row.completed_at).not.toBeNull();
    expect(row.archived_at).not.toBeNull();
    expect((await allEvents()).map((e) => e.type)).toEqual(["task.created", "task.archived", "task.completed"]);
  });

  it("last write wins per field, in server order", async () => {
    const task = uid();
    await alex.mutate("task.created", { task_id: task, title: "Original" });
    await alex.mutate("task.updated", { task_id: task, fields: { title: "Alex's title" } });
    await sam.mutate("task.updated", { task_id: task, fields: { title: "Sam's title", priority: "high" } });
    const row = await env.DB.prepare("SELECT title, priority FROM tasks WHERE id = ?").bind(task).first<any>();
    expect(row).toEqual({ title: "Sam's title", priority: "high" });
    const events = await allEvents();
    expect(events[2].payload.before).toEqual({ title: "Alex's title", priority: "normal" });
  });
});

describe("validation", () => {
  it("refuses bad input and writes no event", async () => {
    const task = uid();
    const bad: Array<[string, Record<string, unknown>]> = [
      ["task.created", { task_id: task, title: "   " }],
      ["task.created", { task_id: task, title: "ok", due_date: "2026-13-45" }],
      ["task.created", { task_id: task, title: "ok", owner_email: "stranger@example.test" }],
      ["task.created", { task_id: task, title: "ok", surprise: true }],
      ["task.updated", { task_id: task, fields: {} }],
      ["task.completed", { task_id: uid() }], // no such task
      ["item.ticked", { item_id: uid() }],
      ["attachment.added", { task_id: task, attachment_id: uid(), name: "big", mime: "image/jpeg", size: 11 * 1024 * 1024 }],
    ];
    for (const [type, payload] of bad) {
      const res = await alex.mutate(type, payload);
      expect([400, 404], `${type} ${JSON.stringify(payload)}`).toContain(res.status);
    }
    expect(await count("events")).toBe(0);
  });

  it("refuses an id that is already in use", async () => {
    const task = uid();
    await alex.mutate("task.created", { task_id: task, title: "One" });
    const res = await sam.mutate("task.created", { task_id: task, title: "Two" });
    expect(res.status).toBe(409);
    expect(await count("events")).toBe(1);
  });
});

describe("the event log", () => {
  it("rejects UPDATE and DELETE in the database", async () => {
    await alex.mutate("task.created", { task_id: uid(), title: "Kept" });
    await expect(env.DB.prepare("UPDATE events SET type = 'task.archived'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM events").run()).rejects.toThrow(/append-only/);
    expect(await count("events")).toBe(1);
  });

  it("lets current state be rebuilt from the events alone", async () => {
    const t1 = uid();
    const t2 = uid();
    const i1 = uid();
    const i2 = uid();
    const n1 = uid();
    const f1 = uid();

    await alex.mutate("user.named", { name: "Alex" });
    await sam.mutate("user.named", { name: "Sam" });
    await alex.mutate("task.created", { task_id: t1, title: "Board pack", description: "Q4", due_date: "2026-12-05", priority: "high", owner_email: SAM });
    await alex.mutate("task.created", { task_id: t2, title: "Hiring plan" });
    await alex.mutate("item.added", { task_id: t1, item_id: i1, text: "Numbers", position: "a0" });
    await sam.mutate("item.added", { task_id: t1, item_id: i2, text: "Narrative", position: "a1" });
    await sam.mutate("item.ticked", { item_id: i1 });
    await alex.mutate("item.moved", { item_id: i2, position: "Zz" });
    await alex.mutate("item.edited", { item_id: i2, text: "Narrative and risks" });
    await sam.mutate("item.removed", { item_id: i1 });
    await sam.mutate("note.added", { task_id: t1, note_id: n1, body: "Sent draft" });
    await alex.mutate("attachment.added", { task_id: t1, attachment_id: f1, name: "pack.pdf", mime: "application/pdf", size: 99 });
    await sam.mutate("attachment.removed", { attachment_id: f1 });
    await sam.mutate("task.updated", { task_id: t1, fields: { description: null, due_date: null } });
    await alex.mutate("task.reassigned", { task_id: t2, owner_email: SAM });
    await alex.mutate("task.completed", { task_id: t2 });
    await sam.mutate("task.archived", { task_id: t2 });
    await alex.mutate("task.completed", { task_id: t2 }); // conflict: archived by the other person
    await alex.mutate("task.reopened", { task_id: t2 });

    const rebuilt = reduce(await allEvents());

    const byId = async (table: string) => {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all<any>();
      return Object.fromEntries(results.map((r) => [r.id, r]));
    };
    expect(rebuilt.tasks).toEqual(await byId("tasks"));
    expect(rebuilt.items).toEqual(await byId("items"));
    expect(rebuilt.notes).toEqual(await byId("notes"));
    expect(rebuilt.attachments).toEqual(await byId("attachments"));

    const { results: users } = await env.DB.prepare("SELECT email, name FROM users WHERE name IS NOT NULL").all<any>();
    expect(rebuilt.names).toEqual(Object.fromEntries(users.map((u) => [u.email, u.name])));
    expect(Object.keys(rebuilt.tasks)).toHaveLength(2);
  });
});
