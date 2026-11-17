import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EventType, Item } from "../shared/model";
import { formatDue } from "./dates";
import History from "./History";
import { between } from "./position";
import { detailFor } from "./select";
import { apply, getSnapshot, markTaskRead, newTaskId, subscribe } from "./store";

export default function TaskDetail({ id, nameFor, onBack }: { id: string; nameFor: (email: string) => string; onBack: () => void }) {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const detail = detailFor(s, id);
  const [undo, setUndo] = useState<{ label: string; type: EventType } | null>(null);

  useEffect(() => {
    void markTaskRead(id);
  }, [id, s.cursor]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  const run = useCallback((type: EventType, payload: Record<string, unknown>) => void apply(type, payload), []);

  if (!detail) return <p className="shell notice">That task is not on this device yet.</p>;
  const { task, items, notes } = detail;
  const live = items.filter((i) => !i.removed_at);
  const itemText = (itemId: string) => items.find((i) => i.id === itemId)?.text ?? "an item";
  const update = (fields: Record<string, unknown>) => run("task.updated", { task_id: id, fields });

  function act(type: EventType, label: string, inverse: EventType) {
    run(type, { task_id: id });
    setUndo({ label, type: inverse });
  }

  function move(item: Item, by: -1 | 1) {
    const at = live.findIndex((i) => i.id === item.id);
    const to = at + by;
    if (to < 0 || to >= live.length) return;
    const rest = live.filter((i) => i.id !== item.id);
    const before = to > 0 ? (rest[to - 1]?.position ?? null) : null;
    const after = rest[to]?.position ?? null;
    run("item.moved", { item_id: item.id, position: between(before, after) });
  }

  const other = s.me?.other?.email;
  return (
    <div className="shell">
      <header className="masthead">
        <button className="back" onClick={onBack}>
          ← Back
        </button>
      </header>

      <Editable className="detail-title" value={task.title} placeholder="Title" multiline onSave={(t) => t.trim() && update({ title: t.trim() })} />

      <div className="facts">
        <button
          className="fact"
          disabled={!other}
          onClick={() => run("task.reassigned", { task_id: id, owner_email: task.owner_email === s.me!.email ? other : s.me!.email })}
        >
          <span className="fact-label">Owner</span>
          <span>{nameFor(task.owner_email)}</span>
        </button>
        <label className="fact">
          <span className="fact-label">Due</span>
          <span className="tnum">{task.due_date ? formatDue(task.due_date) : "Not set"}</span>
          <input type="date" className="fact-input" value={task.due_date ?? ""} onChange={(e) => update({ due_date: e.target.value || null })} />
        </label>
        <button className="fact" onClick={() => update({ priority: task.priority === "high" ? "normal" : "high" })}>
          <span className="fact-label">Priority</span>
          <span>{task.priority === "high" ? "High" : "Normal"}</span>
        </button>
      </div>

      <Editable
        className="detail-description"
        value={task.description ?? ""}
        placeholder="Add a description"
        multiline
        onSave={(d) => update({ description: d.trim() })}
      />

      <section className="section">
        <h2 className="section-title">Checklist</h2>
        {live.map((item, i) => (
          <div className="item" key={item.id}>
            <button
              className="tick"
              aria-pressed={item.done === 1}
              aria-label={item.done ? "Untick" : "Tick"}
              onClick={() => run(item.done ? "item.unticked" : "item.ticked", { item_id: item.id })}
            >
              {item.done ? "✓" : ""}
            </button>
            <Editable
              className={item.done ? "item-text item-done" : "item-text"}
              value={item.text}
              onSave={(text) => text.trim() && text.trim() !== item.text && run("item.edited", { item_id: item.id, text: text.trim() })}
            />
            <span className="item-actions">
              <button className="quiet" disabled={i === 0} aria-label="Move up" onClick={() => move(item, -1)}>
                ↑
              </button>
              <button className="quiet" disabled={i === live.length - 1} aria-label="Move down" onClick={() => move(item, 1)}>
                ↓
              </button>
              <button className="quiet" aria-label="Remove" onClick={() => run("item.removed", { item_id: item.id })}>
                ×
              </button>
            </span>
          </div>
        ))}
        <AddLine
          placeholder="Add an item"
          onAdd={(text) => run("item.added", { task_id: id, item_id: newTaskId(), text, position: between(live.at(-1)?.position ?? null, null) })}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Notes</h2>
        {notes.map((n) => (
          <div className="note" key={n.id}>
            <p className="note-meta tnum">
              {nameFor(n.author_email)} · {new Date(n.created_at).toLocaleString()}
            </p>
            <p className="note-body">{n.body}</p>
          </div>
        ))}
        <AddLine placeholder="Add a note" multiline onAdd={(body) => run("note.added", { task_id: id, note_id: newTaskId(), body })} />
      </section>

      <section className="section">
        <h2 className="section-title">History</h2>
        <History events={detail.history} nameFor={nameFor} itemText={itemText} />
      </section>

      <div className="detail-actions">
        {task.completed_at ? (
          <button className="button button-quiet" onClick={() => run("task.reopened", { task_id: id })}>
            Reopen
          </button>
        ) : (
          <button className="button" onClick={() => act("task.completed", "Completed", "task.reopened")}>
            Complete
          </button>
        )}
        {task.archived_at ? (
          <button className="button button-quiet" onClick={() => run("task.restored", { task_id: id })}>
            Restore
          </button>
        ) : (
          <button className="button button-quiet" onClick={() => act("task.archived", "Archived", "task.restored")}>
            Archive
          </button>
        )}
      </div>

      {undo && (
        <div className="undo" role="status">
          <span>{undo.label}</span>
          <button
            className="quiet"
            onClick={() => {
              const type = undo.type;
              setUndo(null);
              run(type, { task_id: id });
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/** Text that becomes an input when you tap it, and saves when you leave it. */
function Editable({
  value,
  onSave,
  className,
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);

  // Grow to fit, so a long title wraps instead of scrolling out of sight.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const props = {
    className: `${className ?? ""} editable`,
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => draft !== value && onSave(draft),
  };
  return multiline ? <textarea ref={box} rows={1} {...props} /> : <input {...props} />;
}

function AddLine({ onAdd, placeholder, multiline }: { onAdd: (text: string) => void; placeholder: string; multiline?: boolean }) {
  const [text, setText] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  }
  return (
    <form className="add-line" onSubmit={submit}>
      {multiline ? (
        <textarea className="editable" rows={2} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      ) : (
        <input className="editable" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      )}
      <button className="button button-quiet" disabled={!text.trim()}>
        Add
      </button>
    </form>
  );
}
