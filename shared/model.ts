// Types shared by the Worker, the client and the tests. Pure TypeScript: no DOM, no Workers types.

export type Priority = "normal" | "high";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  owner_email: string;
  due_date: string | null; // YYYY-MM-DD
  priority: Priority;
  created_by: string;
  created_at: string; // UTC ISO 8601
  completed_at: string | null;
  archived_at: string | null;
  updated_at: string;
}

export interface Item {
  id: string;
  task_id: string;
  text: string;
  position: string;
  done: 0 | 1;
  removed_at: string | null;
}

export interface Note {
  id: string;
  task_id: string;
  author_email: string;
  body: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  task_id: string;
  name: string;
  mime: string;
  size: number;
  added_by: string;
  created_at: string;
  removed_at: string | null;
}

export const EVENT_TYPES = [
  "task.created",
  "task.updated",
  "task.reassigned",
  "task.completed",
  "task.reopened",
  "task.archived",
  "task.restored",
  "item.added",
  "item.edited",
  "item.ticked",
  "item.unticked",
  "item.moved",
  "item.removed",
  "note.added",
  "attachment.added",
  "attachment.removed",
  "user.named",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Every event describes one change to one entity. `id` is the entity id (the email for user.named).
 * `before` is null when the entity is created. `before` and `after` hold the same keys, so a
 * reader can show "was X, now Y" without looking anything else up.
 */
export interface EventPayload {
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export interface EventRecord {
  seq: number;
  task_id: string | null;
  actor_email: string;
  actor_name: string | null;
  type: EventType;
  payload: EventPayload;
  client_at: string;
  server_at: string;
  mutation_id: string;
}
