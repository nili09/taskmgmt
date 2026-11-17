import { Hono } from "hono";
import { authenticate } from "./auth";
import { HttpError, type AppEnv } from "./env";
import { applyMutation } from "./mutations";
import { activity, cursors, eventsAfter, exportAll, listTasks, markRead, me, searchTasks, taskDetail, tasksCsv } from "./queries";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const user = await authenticate(c.req.raw, c.env);
  await c.env.DB.prepare("INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)")
    .bind(user.email, new Date().toISOString())
    .run();
  c.set("user", user);
  await next();
  c.header("Cache-Control", "no-store");
});

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, "Invalid number");
  return n;
}

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

app.get("/api/me", async (c) => c.json(await me(c.env, c.get("user").email)));

app.post("/api/mutations", async (c) => c.json(await applyMutation(c.env, c.get("user"), await body(c.req.raw))));

app.get("/api/events", async (c) =>
  c.json(await eventsAfter(c.env.DB, int(c.req.query("after"), 0, 0, Number.MAX_SAFE_INTEGER), int(c.req.query("limit"), 500, 1, 1000))),
);

app.get("/api/activity", async (c) =>
  c.json(
    await activity(
      c.env.DB,
      int(c.req.query("before"), Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
      int(c.req.query("limit"), 50, 1, 200),
    ),
  ),
);

app.get("/api/tasks", async (c) => c.json(await listTasks(c.env.DB, c.get("user").email, c.req.query("view"))));
app.get("/api/tasks/:id", async (c) => c.json(await taskDetail(c.env.DB, c.get("user").email, c.req.param("id"))));
app.get("/api/search", async (c) => c.json(await searchTasks(c.env.DB, c.get("user").email, c.req.query("q"))));

app.post("/api/tasks/:id/read", async (c) => {
  const { seq } = (await body(c.req.raw)) as { seq?: unknown };
  if (!Number.isInteger(seq) || (seq as number) < 0) throw new HttpError(400, "seq must be a whole number");
  await markRead(c.env.DB, c.get("user").email, c.req.param("id"), seq as number);
  return c.json({ ok: true });
});
app.get("/api/read-cursors", async (c) => c.json(await cursors(c.env.DB, c.get("user").email)));

// --- Attachment bytes -------------------------------------------------------
// The metadata, the event and the history all live in D1. This is only the file.

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The bytes are sent before the mutation that records them, so this does not look for a row:
 * an upload whose mutation never arrives is simply an unreferenced key.
 */
app.put("/api/attachments/:id", async (c) => {
  const id = c.req.param("id");
  if (!ATTACHMENT_ID.test(id)) throw new HttpError(400, "Invalid id");
  const declared = Number(c.req.header("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) throw new HttpError(400, "That file is over 10 MB");
  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new HttpError(400, "That file is over 10 MB");
  await c.env.ATTACHMENTS.put(id, bytes, {
    metadata: { mime: c.req.header("content-type") ?? "application/octet-stream" },
  });
  return c.json({ ok: true });
});

/** Served only from here, never from a public URL, and never once it has been removed. */
app.get("/api/attachments/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT name, mime, removed_at FROM attachments WHERE id = ?")
    .bind(id)
    .first<{ name: string; mime: string; removed_at: string | null }>();
  if (!row || row.removed_at) throw new HttpError(404, "Not found");
  const bytes = await c.env.ATTACHMENTS.get(id, "arrayBuffer");
  if (!bytes) throw new HttpError(404, "Not found");
  return c.body(bytes, 200, {
    "Content-Type": row.mime,
    "Content-Disposition": `inline; filename="${row.name.replace(/[\r\n"]/g, "")}"`,
  });
});

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

app.get("/api/export.json", async (c) => {
  const data = await exportAll(c.env.DB);
  return c.body(JSON.stringify(data, null, 2), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="tandem-${stamp()}.json"`,
  });
});

app.get("/api/export.csv", async (c) => {
  const { tasks } = await exportAll(c.env.DB);
  return c.body(tasksCsv(tasks), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="tandem-tasks-${stamp()}.csv"`,
  });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

export default app;
