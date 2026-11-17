import { z } from "zod";
import { EVENT_TYPES, type EventRecord, type EventType } from "../shared/model";
import { allowedEmails, HttpError, type Env, type User } from "./env";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid id");
const email = z.string().trim().toLowerCase().pipe(z.email());
const title = z.string().trim().min(1).max(200);
const description = z
  .string()
  .trim()
  .max(10_000)
  .transform((s) => (s === "" ? null : s))
  .nullable();
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), "Invalid date")
  .nullable();
const priority = z.enum(["normal", "high"]);
const itemText = z.string().trim().min(1).max(500);
const position = z.string().min(1).max(64);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const envelope = z.object({
  id,
  type: z.enum(EVENT_TYPES),
  client_at: z.iso.datetime({ offset: true }),
  payload: z.unknown(),
});

const payloads = {
  "task.created": z
    .object({
      task_id: id,
      title,
      description: description.optional(),
      owner_email: email.optional(),
      due_date: dueDate.optional(),
      priority: priority.optional(),
    })
    .strict(),
  "task.updated": z
    .object({
      task_id: id,
      fields: z
        .object({ title: title.optional(), description: description.optional(), due_date: dueDate.optional(), priority: priority.optional() })
        .strict()
        .refine((f) => Object.keys(f).length > 0, "Nothing to change"),
    })
    .strict(),
  "task.reassigned": z.object({ task_id: id, owner_email: email }).strict(),
  "task.completed": z.object({ task_id: id }).strict(),
  "task.reopened": z.object({ task_id: id }).strict(),
  "task.archived": z.object({ task_id: id }).strict(),
  "task.restored": z.object({ task_id: id }).strict(),
  "item.added": z.object({ task_id: id, item_id: id, text: itemText, position }).strict(),
  "item.edited": z.object({ item_id: id, text: itemText }).strict(),
  "item.ticked": z.object({ item_id: id }).strict(),
  "item.unticked": z.object({ item_id: id }).strict(),
  "item.moved": z.object({ item_id: id, position }).strict(),
  "item.removed": z.object({ item_id: id }).strict(),
  "note.added": z.object({ task_id: id, note_id: id, body: z.string().trim().min(1).max(5000) }).strict(),
  "attachment.added": z
    .object({
      task_id: id,
      attachment_id: id,
      name: z.string().trim().min(1).max(255),
      mime: z.string().trim().min(1).max(127),
      size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
    })
    .strict(),
  "attachment.removed": z.object({ attachment_id: id }).strict(),
  "user.named": z.object({ name: z.string().trim().min(1).max(80) }).strict(),
} satisfies Record<EventType, z.ZodType>;

// ---------------------------------------------------------------------------
// A mutation becomes an Op: one change to one entity.
// ---------------------------------------------------------------------------

type Table = "tasks" | "items" | "notes" | "attachments" | "users";

interface Op {
  taskId: string | null;
  table: Table;
  entityId: string;
  /** Set when the entity is created: the full row to insert. */
  create?: Record<string, unknown>;
  /** The new values of the fields this event changes. */
  after: Record<string, unknown>;
}

interface Ctx {
  db: D1Database;
  actor: { email: string; name: string | null };
  now: string;
  allowed: string[];
}

async function requireTask(ctx: Ctx, taskId: string): Promise<string> {
  const row = await ctx.db.prepare("SELECT id FROM tasks WHERE id = ?").bind(taskId).first();
  if (!row) throw new HttpError(404, "Task not found");
  return taskId;
}

async function taskOf(ctx: Ctx, table: "items" | "attachments", entityId: string): Promise<string> {
  const row = await ctx.db.prepare(`SELECT task_id FROM ${table} WHERE id = ?`).bind(entityId).first<{ task_id: string }>();
  if (!row) throw new HttpError(404, table === "items" ? "Item not found" : "Attachment not found");
  return row.task_id;
}

function requireAllowed(ctx: Ctx, owner: string) {
  if (!ctx.allowed.includes(owner)) throw new HttpError(400, "Owner must be one of the two people");
}

type Payload<K extends EventType> = z.infer<(typeof payloads)[K]>;

// Last write wins per field, in server order, so none of these refuse on state:
// completing an archived task, ticking a removed item and so on all just apply.
const handlers: { [K in EventType]: (ctx: Ctx, p: Payload<K>) => Promise<Op> } = {
  async "task.created"(ctx, p) {
    const owner = p.owner_email ?? ctx.actor.email;
    requireAllowed(ctx, owner);
    const after = {
      title: p.title,
      description: p.description ?? null,
      owner_email: owner,
      due_date: p.due_date ?? null,
      priority: p.priority ?? "normal",
    };
    const create = {
      id: p.task_id,
      ...after,
      created_by: ctx.actor.email,
      created_at: ctx.now,
      completed_at: null,
      archived_at: null,
      updated_at: ctx.now,
    };
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, create, after };
  },
  async "task.updated"(ctx, p) {
    await requireTask(ctx, p.task_id);
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, after: p.fields };
  },
  async "task.reassigned"(ctx, p) {
    requireAllowed(ctx, p.owner_email);
    await requireTask(ctx, p.task_id);
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, after: { owner_email: p.owner_email } };
  },
  async "task.completed"(ctx, p) {
    await requireTask(ctx, p.task_id);
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, after: { completed_at: ctx.now } };
  },
  async "task.reopened"(ctx, p) {
    await requireTask(ctx, p.task_id);
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, after: { completed_at: null } };
  },
  async "task.archived"(ctx, p) {
    await requireTask(ctx, p.task_id);
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, after: { archived_at: ctx.now } };
  },
  async "task.restored"(ctx, p) {
    await requireTask(ctx, p.task_id);
    return { taskId: p.task_id, table: "tasks", entityId: p.task_id, after: { archived_at: null } };
  },
  async "item.added"(ctx, p) {
    await requireTask(ctx, p.task_id);
    const after = { text: p.text, position: p.position };
    const create = { id: p.item_id, task_id: p.task_id, ...after, done: 0, removed_at: null };
    return { taskId: p.task_id, table: "items", entityId: p.item_id, create, after };
  },
  async "item.edited"(ctx, p) {
    return { taskId: await taskOf(ctx, "items", p.item_id), table: "items", entityId: p.item_id, after: { text: p.text } };
  },
  async "item.ticked"(ctx, p) {
    return { taskId: await taskOf(ctx, "items", p.item_id), table: "items", entityId: p.item_id, after: { done: 1 } };
  },
  async "item.unticked"(ctx, p) {
    return { taskId: await taskOf(ctx, "items", p.item_id), table: "items", entityId: p.item_id, after: { done: 0 } };
  },
  async "item.moved"(ctx, p) {
    return { taskId: await taskOf(ctx, "items", p.item_id), table: "items", entityId: p.item_id, after: { position: p.position } };
  },
  async "item.removed"(ctx, p) {
    return { taskId: await taskOf(ctx, "items", p.item_id), table: "items", entityId: p.item_id, after: { removed_at: ctx.now } };
  },
  async "note.added"(ctx, p) {
    await requireTask(ctx, p.task_id);
    const create = { id: p.note_id, task_id: p.task_id, author_email: ctx.actor.email, body: p.body, created_at: ctx.now };
    return { taskId: p.task_id, table: "notes", entityId: p.note_id, create, after: { body: p.body } };
  },
  async "attachment.added"(ctx, p) {
    await requireTask(ctx, p.task_id);
    const after = { name: p.name, mime: p.mime, size: p.size };
    const create = { id: p.attachment_id, task_id: p.task_id, ...after, added_by: ctx.actor.email, created_at: ctx.now, removed_at: null };
    return { taskId: p.task_id, table: "attachments", entityId: p.attachment_id, create, after };
  },
  async "attachment.removed"(ctx, p) {
    const taskId = await taskOf(ctx, "attachments", p.attachment_id);
    return { taskId, table: "attachments", entityId: p.attachment_id, after: { removed_at: ctx.now } };
  },
  async "user.named"(ctx, p) {
    return { taskId: null, table: "users", entityId: ctx.actor.email, after: { name: p.name } };
  },
};

// ---------------------------------------------------------------------------
// An Op becomes one D1 batch: the event, then the state change it describes.
// ---------------------------------------------------------------------------

const COLUMN = /^[a-z_]+$/;

function buildBatch(ctx: Ctx, m: { id: string; type: EventType; client_at: string }, op: Op): D1PreparedStatement[] {
  const keyColumn = op.table === "users" ? "email" : "id";
  const columns = Object.keys(op.after);
  for (const c of columns) if (!COLUMN.test(c)) throw new Error(`bad column ${c}`);

  // The event goes first so that its "before" is read from the row as it is just before
  // this batch changes it, even if another request landed a moment earlier.
  let payloadSql: string;
  let payloadParams: unknown[];
  if (op.create) {
    payloadSql = `json_object('id', ?, 'before', NULL, 'after', json(?))`;
    payloadParams = [op.entityId, JSON.stringify(op.after)];
  } else {
    const picked = columns.map((c) => `'${c}', ${c}`).join(", ");
    payloadSql = `json_object('id', ?, 'before', json((SELECT json_object(${picked}) FROM ${op.table} WHERE ${keyColumn} = ?)), 'after', json(?))`;
    payloadParams = [op.entityId, op.entityId, JSON.stringify(op.after)];
  }

  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO events (task_id, actor_email, actor_name, type, payload, client_at, server_at, mutation_id)
         VALUES (?, ?, ?, ?, ${payloadSql}, ?, ?, ?)`,
      )
      .bind(op.taskId, ctx.actor.email, ctx.actor.name, m.type, ...payloadParams, m.client_at, ctx.now, m.id),
  ];

  if (op.create) {
    const cols = Object.keys(op.create);
    for (const c of cols) if (!COLUMN.test(c)) throw new Error(`bad column ${c}`);
    statements.push(
      ctx.db
        .prepare(`INSERT INTO ${op.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .bind(...Object.values(op.create)),
    );
  } else {
    statements.push(
      ctx.db
        .prepare(`UPDATE ${op.table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE ${keyColumn} = ?`)
        .bind(...Object.values(op.after), op.entityId),
    );
  }

  if (op.taskId && !(op.table === "tasks" && op.create)) {
    statements.push(ctx.db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").bind(ctx.now, op.taskId));
  }
  return statements;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface EventRow {
  seq: number;
  task_id: string | null;
  actor_email: string;
  actor_name: string | null;
  type: EventType;
  payload: string;
  client_at: string;
  server_at: string;
  mutation_id: string;
}

export function toEvent(row: EventRow): EventRecord {
  return { ...row, payload: JSON.parse(row.payload) };
}

async function eventByMutation(db: D1Database, mutationId: string): Promise<EventRecord | null> {
  const row = await db.prepare("SELECT * FROM events WHERE mutation_id = ?").bind(mutationId).first<EventRow>();
  return row ? toEvent(row) : null;
}

/** Apply one mutation. Replaying the same mutation id returns the original event and changes nothing. */
export async function applyMutation(env: Env, user: User, raw: unknown): Promise<{ event: EventRecord; replayed: boolean }> {
  const head = envelope.safeParse(raw);
  if (!head.success) throw new HttpError(400, describe(head.error));
  const m = head.data;
  const db = env.DB;

  const prior = await eventByMutation(db, m.id);
  if (prior) return { event: prior, replayed: true };

  const parsed = payloads[m.type].safeParse(m.payload);
  if (!parsed.success) throw new HttpError(400, describe(parsed.error));

  const person = await db.prepare("SELECT name FROM users WHERE email = ?").bind(user.email).first<{ name: string | null }>();
  const ctx: Ctx = {
    db,
    actor: { email: user.email, name: person?.name ?? null },
    now: new Date().toISOString(),
    allowed: allowedEmails(env),
  };

  const op = await (handlers[m.type] as (ctx: Ctx, p: unknown) => Promise<Op>)(ctx, parsed.data);
  if (op.create) {
    const clash = await db.prepare(`SELECT 1 AS x FROM ${op.table} WHERE id = ?`).bind(op.entityId).first();
    if (clash) throw new HttpError(409, "That id is already in use");
  }

  const statements = buildBatch(ctx, { id: m.id, type: m.type, client_at: new Date(m.client_at).toISOString() }, op);
  try {
    await db.batch(statements);
  } catch (err) {
    // The same mutation arriving twice at once: the loser's batch rolls back whole.
    const winner = await eventByMutation(db, m.id);
    if (winner) return { event: winner, replayed: true };
    throw err;
  }
  const event = await eventByMutation(db, m.id);
  if (!event) throw new Error("event missing after batch");
  return { event, replayed: false };
}

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
}
