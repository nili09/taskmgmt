import type { EventRecord, Item, Note, Task } from "../shared/model";
import type { Snapshot } from "./store";
import type { View } from "./api";

export type TaskRow = Task & { unread: 0 | 1 };

/** A task is unread for me when the other person has changed it since I last opened it. */
function unreadFor(s: Snapshot, taskId: string): 0 | 1 {
  const seen = s.cursors[taskId] ?? 0;
  return s.events.some((e) => e.task_id === taskId && e.actor_email !== s.me?.email && e.seq > seen) ? 1 : 0;
}

const withUnread = (s: Snapshot, tasks: Task[]): TaskRow[] => tasks.map((t) => ({ ...t, unread: unreadFor(s, t.id) }));

/**
 * The same order the API uses: overdue first, then by due date (no date last), then high
 * priority, then most recently changed.
 */
function openOrder(a: Task, b: Task): number {
  if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
  return a.updated_at < b.updated_at ? 1 : -1;
}

const byChanged = (a: Task, b: Task) => (a.updated_at < b.updated_at ? 1 : -1);

export function tasksFor(s: Snapshot, view: View): TaskRow[] {
  const all = Object.values(s.state.tasks);
  const open = (t: Task) => !t.completed_at && !t.archived_at;
  const me = s.me?.email;
  switch (view) {
    case "open":
      return withUnread(s, all.filter(open).sort(openOrder));
    case "mine":
      return withUnread(s, all.filter((t) => open(t) && t.owner_email === me).sort(openOrder));
    case "theirs":
      return withUnread(s, all.filter((t) => open(t) && t.owner_email !== me).sort(openOrder));
    case "done":
      return withUnread(s, all.filter((t) => t.completed_at && !t.archived_at).sort(byChanged));
    case "archived":
      return withUnread(s, all.filter((t) => t.archived_at).sort(byChanged));
  }
}

export function searchTasks(s: Snapshot, q: string): TaskRow[] {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const has = (text: string | null | undefined) => !!text && text.toLowerCase().includes(term);
  const items = Object.values(s.state.items);
  const notes = Object.values(s.state.notes);
  const hit = (t: Task) =>
    has(t.title) ||
    has(t.description) ||
    items.some((i) => i.task_id === t.id && !i.removed_at && has(i.text)) ||
    notes.some((n) => n.task_id === t.id && has(n.body));
  return withUnread(s, Object.values(s.state.tasks).filter(hit).sort(byChanged));
}

export interface Detail {
  task: TaskRow;
  items: Item[];
  notes: Note[];
  history: EventRecord[];
}

export function detailFor(s: Snapshot, id: string): Detail | null {
  const task = s.state.tasks[id];
  if (!task) return null;
  return {
    task: { ...task, unread: unreadFor(s, id) },
    items: Object.values(s.state.items)
      .filter((i) => i.task_id === id)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1)),
    notes: Object.values(s.state.notes)
      .filter((n) => n.task_id === id)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
    history: s.events.filter((e) => e.task_id === id),
  };
}

/** The global activity view: every task event, newest first. */
export const activityFor = (s: Snapshot) => s.events.filter((e) => e.task_id).slice().reverse();

export const titleOf = (s: Snapshot, e: EventRecord) => (e.task_id && s.state.tasks[e.task_id]?.title) || "";
