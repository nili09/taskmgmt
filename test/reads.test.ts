import { describe, expect, it } from "vitest";
import { accessToken, ALEX, as, request, SAM, uid } from "./helpers";

const alex = as(ALEX);
const sam = as(SAM);

async function task(who: typeof alex, title: string, extra: Record<string, unknown> = {}) {
  const task_id = uid();
  const res = await who.mutate("task.created", { task_id, title, ...extra });
  expect(res.status).toBe(200);
  return task_id;
}

describe("events feed", () => {
  it("returns events after a cursor, oldest first, and says when there are more", async () => {
    for (const t of ["a", "b", "c"]) await task(alex, t);
    const first = (await sam.get("/api/events?after=0&limit=2")).body;
    expect(first.events.map((e: any) => e.seq)).toEqual([1, 2]);
    expect(first.more).toBe(true);
    expect(first.cursor).toBe(2);

    const rest = (await sam.get(`/api/events?after=${first.cursor}&limit=2`)).body;
    expect(rest.events.map((e: any) => e.seq)).toEqual([3]);
    expect(rest.more).toBe(false);

    const none = (await sam.get("/api/events?after=3")).body;
    expect(none).toEqual({ events: [], cursor: 3, more: false });
    expect((await sam.get("/api/events?after=-1")).status).toBe(400);
  });
});

describe("views", () => {
  it("splits tasks into open, mine, theirs, done and archived", async () => {
    await task(alex, "Mine");
    await task(alex, "Theirs", { owner_email: SAM });
    const done = await task(alex, "Done");
    const archived = await task(alex, "Archived");
    await alex.mutate("task.completed", { task_id: done });
    await alex.mutate("task.archived", { task_id: archived });

    const titles = async (who: typeof alex, view: string) => (await who.get(`/api/tasks?view=${view}`)).body.map((t: any) => t.title);
    expect((await titles(alex, "open")).sort()).toEqual(["Mine", "Theirs"]);
    expect(await titles(alex, "mine")).toEqual(["Mine"]);
    expect(await titles(alex, "theirs")).toEqual(["Theirs"]);
    expect(await titles(alex, "done")).toEqual(["Done"]);
    expect(await titles(alex, "archived")).toEqual(["Archived"]);
    expect(await titles(sam, "mine")).toEqual(["Theirs"]);
    expect((await alex.get("/api/tasks?view=nonsense")).status).toBe(400);
  });

  it("sorts open tasks by due date (no date last), then high priority, then latest change", async () => {
    await task(alex, "No date, normal");
    await task(alex, "Later", { due_date: "2027-01-10" });
    await task(alex, "Overdue", { due_date: "2020-01-01" });
    await task(alex, "Same day, normal", { due_date: "2027-01-10" });
    await task(alex, "Same day, high", { due_date: "2027-01-10", priority: "high" });
    const recent = await task(alex, "No date, changed last");
    await alex.mutate("task.updated", { task_id: recent, fields: { description: "touched" } });

    const titles = (await alex.get("/api/tasks")).body.map((t: any) => t.title);
    expect(titles).toEqual([
      "Overdue",
      "Same day, high",
      "Same day, normal", // created after "Later", so changed more recently
      "Later",
      "No date, changed last",
      "No date, normal",
    ]);
  });
});

describe("unread", () => {
  it("marks a task the other person changed since I last opened it", async () => {
    const t = await task(alex, "Shared");
    const unread = async (who: typeof alex) => (await who.get("/api/tasks")).body[0].unread;

    expect(await unread(alex)).toBe(0); // my own change
    expect(await unread(sam)).toBe(1); // never opened

    const seen = (await sam.get(`/api/tasks/${t}`)).body.history.at(-1).seq;
    await sam.post(`/api/tasks/${t}/read`, { seq: seen });
    expect(await unread(sam)).toBe(0);

    await alex.mutate("item.added", { task_id: t, item_id: uid(), text: "Tick me", position: "a0" });
    expect(await unread(sam)).toBe(1); // checklist changes show as unread
    expect(await unread(alex)).toBe(0);

    // The cursor only moves forward.
    await sam.post(`/api/tasks/${t}/read`, { seq: 999 });
    await sam.post(`/api/tasks/${t}/read`, { seq: 1 });
    expect((await sam.get("/api/read-cursors")).body).toEqual({ [t]: 999 });
    expect((await sam.post(`/api/tasks/${uid()}/read`, { seq: 1 })).status).toBe(404);
  });
});

describe("task detail, activity and search", () => {
  it("returns the task with its items, notes, attachments and full history", async () => {
    const t = await task(alex, "Detail");
    await sam.mutate("note.added", { task_id: t, note_id: uid(), body: "A note" });
    await sam.mutate("item.added", { task_id: t, item_id: uid(), text: "An item", position: "a0" });
    const d = (await alex.get(`/api/tasks/${t}`)).body;
    expect(d.task.title).toBe("Detail");
    expect(d.notes.map((n: any) => n.body)).toEqual(["A note"]);
    expect(d.items.map((i: any) => i.text)).toEqual(["An item"]);
    expect(d.history.map((e: any) => e.type)).toEqual(["task.created", "note.added", "item.added"]);
    expect((await alex.get(`/api/tasks/${uid()}`)).status).toBe(404);
  });

  it("lists activity across tasks, newest first, without events that belong to no task", async () => {
    const a = await task(alex, "First task");
    await task(sam, "Second task");
    await alex.mutate("user.named", { name: "Alex" });
    await alex.mutate("task.completed", { task_id: a });
    const page = (await sam.get("/api/activity")).body;
    expect(page.events.map((e: any) => [e.type, e.task_title])).toEqual([
      ["task.completed", "First task"],
      ["task.created", "Second task"],
      ["task.created", "First task"],
    ]);
    const older = (await sam.get(`/api/activity?before=${page.events[1].seq}&limit=1`)).body;
    expect(older.events.map((e: any) => e.task_id)).toEqual([a]);
  });

  it("searches titles, descriptions, checklist items and notes, including archived tasks", async () => {
    const byTitle = await task(alex, "Quarterly budget");
    const byDescription = await task(alex, "Plain", { description: "mentions the budget twice" });
    const byItem = await task(alex, "Items");
    const byNote = await task(alex, "Notes");
    const archived = await task(alex, "Old");
    const removedItem = await task(alex, "Removed");
    await alex.mutate("item.added", { task_id: byItem, item_id: uid(), text: "Confirm budget owner", position: "a0" });
    await alex.mutate("note.added", { task_id: byNote, note_id: uid(), body: "budget approved" });
    await alex.mutate("note.added", { task_id: archived, note_id: uid(), body: "old budget" });
    await alex.mutate("task.archived", { task_id: archived });
    const gone = uid();
    await alex.mutate("item.added", { task_id: removedItem, item_id: gone, text: "budget line", position: "a0" });
    await alex.mutate("item.removed", { item_id: gone });
    await task(alex, "Unrelated");

    const ids = (await sam.get("/api/search?q=BUDGET")).body.map((t: any) => t.id).sort();
    expect(ids).toEqual([byTitle, byDescription, byItem, byNote, archived].sort());
    expect((await sam.get("/api/search?q=100%25")).body).toEqual([]); // % is literal
    expect((await sam.get("/api/search?q=")).status).toBe(400);
  });
});

describe("export", () => {
  it("downloads everything as JSON and tasks as CSV", async () => {
    const t = await task(alex, 'He said "hi", then left');
    await task(alex, "=SUM(A1)");
    await sam.mutate("note.added", { task_id: t, note_id: uid(), body: "kept" });

    const json = (await alex.get("/api/export.json")).body;
    expect(json.tasks).toHaveLength(2);
    expect(json.notes).toHaveLength(1);
    expect(json.events).toHaveLength(3);
    expect(json.events[0].payload.after.title).toBe('He said "hi", then left');
    expect(json.users.map((u: any) => u.email).sort()).toEqual([ALEX, SAM]);

    const res = await request("/api/export.csv", { headers: { "cf-access-jwt-assertion": await accessToken(ALEX) } });
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="tandem-tasks-\d{4}-\d\d-\d\d\.csv"$/);
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe(
      "id,title,description,owner_email,due_date,priority,created_by,created_at,completed_at,archived_at,updated_at",
    );
    expect(csv).toContain('"He said ""hi"", then left"');
    expect(csv).toContain("'=SUM(A1)"); // never starts a formula
  });
});
