import type { Attachment, EventRecord, Item, Note, Task } from "./model";

/** Current state as a pure function of the event log. */
export interface State {
  names: Record<string, string | null>;
  tasks: Record<string, Task>;
  items: Record<string, Item>;
  notes: Record<string, Note>;
  attachments: Record<string, Attachment>;
}

export function emptyState(): State {
  return { names: {}, tasks: {}, items: {}, notes: {}, attachments: {} };
}

/** Apply one event, in sequence order. Mutates and returns `s`. */
export function applyEvent(s: State, e: EventRecord): State {
  const { id } = e.payload;
  const after = e.payload.after as Record<string, any>;

  switch (e.type) {
    case "task.created":
      s.tasks[id] = {
        id,
        title: after.title,
        description: after.description,
        owner_email: after.owner_email,
        due_date: after.due_date,
        priority: after.priority,
        created_by: e.actor_email,
        created_at: e.server_at,
        completed_at: null,
        archived_at: null,
        updated_at: e.server_at,
      };
      break;
    case "task.updated":
    case "task.reassigned":
    case "task.completed":
    case "task.reopened":
    case "task.archived":
    case "task.restored":
      Object.assign(s.tasks[id], after);
      break;
    case "item.added":
      s.items[id] = { id, task_id: e.task_id!, text: after.text, position: after.position, done: 0, removed_at: null };
      break;
    case "item.edited":
    case "item.ticked":
    case "item.unticked":
    case "item.moved":
    case "item.removed":
      Object.assign(s.items[id], after);
      break;
    case "note.added":
      s.notes[id] = { id, task_id: e.task_id!, author_email: e.actor_email, body: after.body, created_at: e.server_at };
      break;
    case "attachment.added":
      s.attachments[id] = {
        id,
        task_id: e.task_id!,
        name: after.name,
        mime: after.mime,
        size: after.size,
        added_by: e.actor_email,
        created_at: e.server_at,
        removed_at: null,
      };
      break;
    case "attachment.removed":
      Object.assign(s.attachments[id], after);
      break;
    case "user.named":
      s.names[id] = after.name;
      break;
  }

  if (e.task_id && s.tasks[e.task_id]) s.tasks[e.task_id].updated_at = e.server_at;
  return s;
}

export function reduce(events: EventRecord[]): State {
  const s = emptyState();
  for (const e of events) applyEvent(s, e);
  return s;
}
