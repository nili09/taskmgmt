import type { EventRecord } from "../shared/model";

/** One line of history: what changed, and for an edit what it was and what it became. */
export interface Line {
  what: string;
  from?: string;
  to?: string;
}

const FIELD: Record<string, string> = {
  title: "title",
  description: "description",
  due_date: "due date",
  priority: "priority",
  owner_email: "owner",
  text: "item",
};

function shorten(s: string): string {
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

export function describeEvent(e: EventRecord, nameFor: (email: string) => string, itemText: (id: string) => string): Line[] {
  const { before, after, id } = e.payload;
  const show = (key: string, raw: unknown): string => {
    if (raw === null || raw === undefined || raw === "") return "nothing";
    if (key === "owner_email") return nameFor(String(raw));
    return shorten(String(raw));
  };
  const edits = (): Line[] =>
    Object.keys(after).map((key) => ({
      what: FIELD[key] ?? key,
      from: before ? show(key, before[key]) : undefined,
      to: show(key, after[key]),
    }));

  switch (e.type) {
    case "task.created":
      return [{ what: "created this task" }];
    case "task.updated":
    case "task.reassigned":
    case "item.edited":
      return edits();
    case "task.completed":
      return [{ what: "completed it" }];
    case "task.reopened":
      return [{ what: "reopened it" }];
    case "task.archived":
      return [{ what: "archived it" }];
    case "task.restored":
      return [{ what: "restored it" }];
    case "item.added":
      return [{ what: `added “${shorten(String(after.text))}”` }];
    case "item.ticked":
      return [{ what: `ticked “${itemText(id)}”` }];
    case "item.unticked":
      return [{ what: `unticked “${itemText(id)}”` }];
    case "item.moved":
      return [{ what: `moved “${itemText(id)}”` }];
    case "item.removed":
      return [{ what: `removed “${itemText(id)}”` }];
    case "note.added":
      return [{ what: "added a note" }];
    case "attachment.added":
      return [{ what: `attached ${shorten(String(after.name))}` }];
    case "attachment.removed":
      return [{ what: "removed an attachment" }];
    case "user.named":
      return [{ what: "set their name", to: show("name", after.name) }];
  }
}
