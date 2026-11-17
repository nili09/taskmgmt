/*
 * The offline store, run against a stand-in Worker and a fake IndexedDB. Proves the parts that
 * only show up without a connection: a change applies at once, waits its turn, goes up in order
 * when the line returns, and survives the other person changing the same task meanwhile.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ME = "me@example.test";
const OTHER = "them@example.test";
let log = [];
let online = true;
let seen = {};

const ENTITY = {
  "task.created": "task_id",
  "task.updated": "task_id",
  "task.completed": "task_id",
  "item.added": "item_id",
  "item.ticked": "item_id",
  "note.added": "note_id",
};

function afterFor(type, p, now) {
  switch (type) {
    case "task.created":
      return { title: p.title, description: p.description ?? null, owner_email: p.owner_email ?? ME, due_date: p.due_date ?? null, priority: p.priority ?? "normal" };
    case "task.updated":
      return p.fields;
    case "task.completed":
      return { completed_at: now };
    case "item.added":
      return { text: p.text, position: p.position };
    case "item.ticked":
      return { done: 1 };
    case "note.added":
      return { body: p.body };
    case "user.named":
      return { name: p.name };
    default:
      throw new Error(`unhandled ${type}`);
  }
}

const lastSeq = () => (log.length ? log[log.length - 1].seq : 0);

function taskOfEntity(m) {
  const id = m.payload[ENTITY[m.type]];
  return log.find((e) => e.payload.id === id)?.task_id ?? null;
}

globalThis.fetch = async (path, init = {}) => {
  if (!online) throw new Error("offline");
  const url = new URL(path, "https://tandem.test");
  const json = (body, status = 200) => ({ ok: status < 400, status, type: "basic", json: async () => body });
  if (url.pathname === "/api/me") return json({ email: ME, name: null, other: { email: OTHER, name: "Dhiman" } });
  if (url.pathname === "/api/read-cursors") return json(seen);
  if (url.pathname.endsWith("/read")) return json({ ok: true });
  if (url.pathname === "/api/events") {
    const after = Number(url.searchParams.get("after"));
    const events = log.filter((e) => e.seq > after);
    return json({ events, cursor: events.length ? events[events.length - 1].seq : after, more: false });
  }
  if (url.pathname === "/api/mutations") {
    const m = JSON.parse(init.body);
    const prior = log.find((e) => e.mutation_id === m.id);
    if (prior) return json({ event: prior, replayed: true });
    const now = new Date().toISOString();
    log.push({
      seq: lastSeq() + 1,
      task_id: m.type === "user.named" ? null : (m.payload.task_id ?? taskOfEntity(m)),
      actor_email: ME,
      actor_name: "Me",
      type: m.type,
      payload: { id: m.payload[ENTITY[m.type]] ?? ME, before: null, after: afterFor(m.type, m.payload, now) },
      client_at: m.client_at,
      server_at: now,
      mutation_id: m.id,
    });
    return json({ event: log[log.length - 1], replayed: false });
  }
  return json({ error: "Not found" }, 404);
};

/** Something the other person did while we were away. */
function theirs(type, taskId, id, after) {
  const now = new Date().toISOString();
  log.push({ seq: lastSeq() + 1, task_id: taskId, actor_email: OTHER, actor_name: "Dhiman", type,
             payload: { id, before: null, after }, client_at: now, server_at: now, mutation_id: `theirs-${lastSeq()}` });
}

Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
globalThis.addEventListener = () => {};
globalThis.document = { visibilityState: "hidden", addEventListener: () => {} };
globalThis.location = { hash: "", reload: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const dir = await mkdtemp(join(tmpdir(), "tandem-"));
await build({ entryPoints: ["src/store.ts", "src/select.ts"], bundle: true, format: "esm", outdir: dir, logLevel: "error" });
const store = await import(join(dir, "store.js"));
const select = await import(join(dir, "select.js"));
test.after(() => rm(dir, { recursive: true, force: true }));

test("a change made with no signal applies at once, then goes up in order", async () => {
  // init() starts the slow poll the app uses while visible; it would hold this process open.
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  await store.init();
  globalThis.setInterval = realInterval;
  assert.equal(store.getSnapshot().me.email, ME);

  await store.apply("user.named", { name: "Me" });
  await store.apply("task.created", { task_id: "t1", title: "Rebuild the basemap", owner_email: ME });
  assert.equal(store.getSnapshot().queued, 0, "sends straight away when online");

  online = false;
  await store.apply("task.updated", { task_id: "t1", fields: { priority: "high" } });
  await store.apply("item.added", { task_id: "t1", item_id: "i1", text: "Pull imagery", position: "i" });
  await store.apply("item.ticked", { item_id: "i1" });

  let s = store.getSnapshot();
  assert.equal(s.state.tasks.t1.priority, "high", "shows before it is sent");
  assert.equal(s.state.items.i1.done, 1);
  assert.equal(s.queued, 3);
  assert.equal(s.online, false);

  // They change the same task while we are away.
  theirs("task.updated", "t1", "t1", { title: "Rebuild the Mumbai basemap" });

  online = true;
  await store.flush();
  s = store.getSnapshot();
  assert.equal(s.queued, 0, "queue cleared");
  assert.equal(s.state.tasks.t1.title, "Rebuild the Mumbai basemap", "their change arrived");
  assert.equal(s.state.tasks.t1.priority, "high", "mine survived");
  assert.deepEqual(
    log.map((e) => e.type),
    ["user.named", "task.created", "task.updated", "task.updated", "item.added", "item.ticked"],
    "sent in the order they were made",
  );
});

test("sending the same change twice changes nothing", async () => {
  const before = log.length;
  const sent = log.find((e) => e.type === "task.updated" && e.actor_email === ME);
  await globalThis.fetch("/api/mutations", {
    body: JSON.stringify({ id: sent.mutation_id, type: "task.updated", client_at: new Date().toISOString(), payload: { task_id: "t1", fields: { priority: "normal" } } }),
  });
  assert.equal(log.length, before);
  assert.equal(store.getSnapshot().state.tasks.t1.priority, "high");
});

test("views, unread and search are worked out on the device", async () => {
  seen = {};
  await store.pull();
  let s = store.getSnapshot();
  assert.equal(select.tasksFor(s, "open").length, 1);
  assert.equal(select.tasksFor(s, "open")[0].unread, 1, "they changed it since I last looked");

  await store.markTaskRead("t1");
  s = store.getSnapshot();
  assert.equal(select.tasksFor(s, "open")[0].unread, 0);
  assert.equal(select.searchTasks(s, "imagery").length, 1, "finds a task by its checklist");
  assert.equal(select.detailFor(s, "t1").items.length, 1);
});
