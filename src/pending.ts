import type { EventRecord, EventType } from "../shared/model";

/** A mutation waiting in the outbox. */
export interface Outgoing {
  id: string;
  type: EventType;
  client_at: string;
  payload: Record<string, any>;
}

/**
 * What a mutation will do, worked out on the device so an offline change shows at once.
 * The server decides the real values; when its event arrives it is applied over this one.
 */
function afterOf(m: Outgoing, now: string): Record<string, unknown> {
  const p = m.payload;
  switch (m.type) {
    case "task.created":
      return {
        title: p.title,
        description: p.description ?? null,
        owner_email: p.owner_email,
        due_date: p.due_date ?? null,
        priority: p.priority ?? "normal",
      };
    case "task.updated":
      return p.fields;
    case "task.reassigned":
      return { owner_email: p.owner_email };
    case "task.completed":
      return { completed_at: now };
    case "task.reopened":
      return { completed_at: null };
    case "task.archived":
      return { archived_at: now };
    case "task.restored":
      return { archived_at: null };
    case "item.added":
      return { text: p.text, position: p.position };
    case "item.edited":
      return { text: p.text };
    case "item.ticked":
      return { done: 1 };
    case "item.unticked":
      return { done: 0 };
    case "item.moved":
      return { position: p.position };
    case "item.removed":
      return { removed_at: now };
    case "note.added":
      return { body: p.body };
    case "attachment.added":
      return { name: p.name, mime: p.mime, size: p.size };
    case "attachment.removed":
      return { removed_at: now };
    case "user.named":
      return { name: p.name };
  }
}

const ENTITY: Partial<Record<EventType, string>> = {
  "task.created": "task_id",
  "task.updated": "task_id",
  "task.reassigned": "task_id",
  "task.completed": "task_id",
  "task.reopened": "task_id",
  "task.archived": "task_id",
  "task.restored": "task_id",
  "item.added": "item_id",
  "item.edited": "item_id",
  "item.ticked": "item_id",
  "item.unticked": "item_id",
  "item.moved": "item_id",
  "item.removed": "item_id",
  "note.added": "note_id",
  "attachment.added": "attachment_id",
  "attachment.removed": "attachment_id",
};

/**
 * The provisional event for a queued mutation. Its sequence number is above every real one so
 * it sorts last; it is thrown away once the server's own event has been pulled.
 */
export function provisionalEvent(m: Outgoing, me: { email: string; name: string | null }, at: number, known: EventRecord[]): EventRecord | null {
  const key = ENTITY[m.type];
  const id = key ? m.payload[key] : me.email;
  const taskId =
    m.type === "user.named"
      ? null
      : (m.payload.task_id ??
        known.find((e) => e.payload.id === id)?.task_id ??
        null);
  return {
    seq: Number.MAX_SAFE_INTEGER - 1000 + at,
    task_id: taskId,
    actor_email: me.email,
    actor_name: me.name,
    type: m.type,
    payload: { id, before: null, after: afterOf(m, m.client_at) },
    client_at: m.client_at,
    server_at: m.client_at,
    mutation_id: m.id,
  };
}
