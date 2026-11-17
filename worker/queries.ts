import type { EventRecord, Task } from "../shared/model";
import { allowedEmails, HttpError, type Env } from "./env";
import { toEvent } from "./mutations";

export const VIEWS = ["open", "mine", "theirs", "done", "archived"] as const;
export type View = (typeof VIEWS)[number];

const OPEN = "t.completed_at IS NULL AND t.archived_at IS NULL";
const WHERE: Record<View, string> = {
  open: OPEN,
  mine: `${OPEN} AND t.owner_email = ?1`,
  theirs: `${OPEN} AND t.owner_email != ?1`,
  done: "t.completed_at IS NOT NULL AND t.archived_at IS NULL",
  archived: "t.archived_at IS NOT NULL",
};
// Overdue tasks have the earliest due dates, so due date ascending (no date last) puts them
// first; then high priority, then most recently changed.
const OPEN_ORDER = "t.due_date IS NULL, t.due_date, t.priority = 'high' DESC, t.updated_at DESC";
const ORDER: Record<View, string> = {
  open: OPEN_ORDER,
  mine: OPEN_ORDER,
  theirs: OPEN_ORDER,
  done: "t.updated_at DESC",
  archived: "t.updated_at DESC",
};

// A task is unread for me when someone else has changed it since the last event I have seen on it.
const TASK_SELECT = `
  SELECT t.*,
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.task_id = t.id AND e.actor_email != ?1
        AND e.seq > COALESCE((SELECT c.last_seq FROM read_cursors c WHERE c.email = ?1 AND c.task_id = t.id), 0)
    ) AS unread
  FROM tasks t`;

export type TaskWithUnread = Task & { unread: 0 | 1 };

export async function me(env: Env, email: string) {
  const allowed = allowedEmails(env);
  const people = await env.DB.prepare("SELECT email, name FROM users WHERE email IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(allowed))
    .all<{ email: string; name: string | null }>();
  const self = people.results.find((p) => p.email === email)!;
  const otherEmail = allowed.find((e) => e !== email) ?? null;
  const other = otherEmail ? (people.results.find((p) => p.email === otherEmail) ?? { email: otherEmail, name: null }) : null;
  return { email: self.email, name: self.name, other };
}

export async function listTasks(db: D1Database, email: string, view: string | undefined): Promise<TaskWithUnread[]> {
  const v = (view ?? "open") as View;
  if (!VIEWS.includes(v)) throw new HttpError(400, "Unknown view");
  const { results } = await db.prepare(`${TASK_SELECT} WHERE ${WHERE[v]} ORDER BY ${ORDER[v]}`).bind(email).all<TaskWithUnread>();
  return results;
}

export async function searchTasks(db: D1Database, email: string, q: string | undefined): Promise<TaskWithUnread[]> {
  const term = (q ?? "").trim();
  if (!term) throw new HttpError(400, "Nothing to search for");
  const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const { results } = await db
    .prepare(
      `${TASK_SELECT}
       WHERE t.title LIKE ?2 ESCAPE '\\' OR t.description LIKE ?2 ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM items i WHERE i.task_id = t.id AND i.removed_at IS NULL AND i.text LIKE ?2 ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM notes n WHERE n.task_id = t.id AND n.body LIKE ?2 ESCAPE '\\')
       ORDER BY t.updated_at DESC`,
    )
    .bind(email, like)
    .all<TaskWithUnread>();
  return results;
}

export async function taskDetail(db: D1Database, email: string, id: string) {
  const task = await db.prepare(`${TASK_SELECT} WHERE t.id = ?2`).bind(email, id).first<TaskWithUnread>();
  if (!task) throw new HttpError(404, "Task not found");
  const [items, notes, attachments, events] = await db.batch([
    db.prepare("SELECT * FROM items WHERE task_id = ? ORDER BY position, id").bind(id),
    db.prepare("SELECT * FROM notes WHERE task_id = ? ORDER BY created_at, id").bind(id),
    db.prepare("SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at, id").bind(id),
    db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").bind(id),
  ]);
  return {
    task,
    items: items.results,
    notes: notes.results,
    attachments: attachments.results,
    history: events.results.map((r) => toEvent(r as never)),
  };
}

/** Every event after `after`, oldest first. This is what the client syncs from. */
export async function eventsAfter(db: D1Database, after: number, limit: number) {
  const { results } = await db
    .prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?")
    .bind(after, limit + 1)
    .all();
  const events: EventRecord[] = results.slice(0, limit).map((r) => toEvent(r as never));
  return { events, cursor: events.length ? events[events.length - 1].seq : after, more: results.length > limit };
}

/** The global activity view: task events across all tasks, newest first. */
export async function activity(db: D1Database, before: number, limit: number) {
  const { results } = await db
    .prepare(
      `SELECT e.*, t.title AS task_title FROM events e JOIN tasks t ON t.id = e.task_id
       WHERE e.seq < ? ORDER BY e.seq DESC LIMIT ?`,
    )
    .bind(before, limit + 1)
    .all<Record<string, unknown> & { task_title: string }>();
  const events = results.slice(0, limit).map((r) => ({ ...toEvent(r as never), task_title: r.task_title }));
  return { events, more: results.length > limit };
}

export async function markRead(db: D1Database, email: string, taskId: string, seq: number) {
  const task = await db.prepare("SELECT 1 AS x FROM tasks WHERE id = ?").bind(taskId).first();
  if (!task) throw new HttpError(404, "Task not found");
  await db
    .prepare(
      `INSERT INTO read_cursors (email, task_id, last_seq) VALUES (?, ?, ?)
       ON CONFLICT (email, task_id) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)`,
    )
    .bind(email, taskId, seq)
    .run();
}

export async function cursors(db: D1Database, email: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT task_id, last_seq FROM read_cursors WHERE email = ?")
    .bind(email)
    .all<{ task_id: string; last_seq: number }>();
  return Object.fromEntries(results.map((r) => [r.task_id, r.last_seq]));
}

export async function exportAll(db: D1Database) {
  const [users, tasks, items, notes, attachments, events] = await db.batch([
    db.prepare("SELECT * FROM users ORDER BY email"),
    db.prepare("SELECT * FROM tasks ORDER BY created_at, id"),
    db.prepare("SELECT * FROM items ORDER BY task_id, position, id"),
    db.prepare("SELECT * FROM notes ORDER BY created_at, id"),
    db.prepare("SELECT * FROM attachments ORDER BY created_at, id"),
    db.prepare("SELECT * FROM events ORDER BY seq"),
  ]);
  return {
    exported_at: new Date().toISOString(),
    users: users.results,
    tasks: tasks.results as unknown as Task[],
    items: items.results,
    notes: notes.results,
    attachments: attachments.results,
    events: events.results.map((r) => toEvent(r as never)),
  };
}

const TASK_CSV_COLUMNS = [
  "id",
  "title",
  "description",
  "owner_email",
  "due_date",
  "priority",
  "created_by",
  "created_at",
  "completed_at",
  "archived_at",
  "updated_at",
] as const;

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Stop a spreadsheet from running a cell that starts like a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tasksCsv(tasks: Task[]): string {
  const rows: string[] = [TASK_CSV_COLUMNS.join(",")];
  for (const t of tasks) rows.push(TASK_CSV_COLUMNS.map((c) => csvCell(t[c])).join(","));
  return rows.join("\r\n") + "\r\n";
}
