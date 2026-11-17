import { useCallback, useEffect, useRef, useState } from "react";
import type { EventType, Item } from "../shared/model";
import { getTask, markRead, mutate, newId, type Detail, type Me } from "./api";
import { formatDue } from "./dates";
import History from "./History";
import { between } from "./position";

export default function TaskDetail({ id, me, onBack, onChanged }: { id: string; me: Me; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; type: EventType } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getTask(id);
      setDetail(d);
      const last = d.history.at(-1);
      if (last) await markRead(id, last.seq);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  if (error) return <p className="shell error">{error}</p>;
  if (!detail) return null;
  const { task, items, notes } = detail;
  const live = items.filter((i) => !i.removed_at);
  const nameFor = (email: string) => (email === me.email ? (me.name ?? "Me") : (me.other?.name ?? email));
  const itemText = (itemId: string) => items.find((i) => i.id === itemId)?.text ?? "an item";

  async function run(type: EventType, payload: Record<string, unknown>) {
    try {
      await mutate(type, payload);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const update = (fields: Record<string, unknown>) => run("task.updated", { task_id: id, fields });

  async function act(type: EventType, label: string, inverse: EventType) {
    await run(type, { task_id: id });
    setUndo({ label, type: inverse });
  }

  function move(item: Item, by: -1 | 1) {
    const at = live.findIndex((i) => i.id === item.id);
    const to = at + by;
    if (to < 0 || to >= live.length) return;
    const rest = live.filter((i) => i.id !== item.id);
    const before = to > 0 ? (rest[to - 1]?.position ?? null) : null;
    const after = rest[to]?.position ?? null;
    void run("item.moved", { item_id: item.id, position: between(before, after) });
  }

  return (
    <div className="shell">
      <header className="masthead">
        <button className="back" onClick={onBack}>
          ← Back
        </button>
      </header>

      <Editable
        className="detail-title"
        value={task.title}
        placeholder="Title"
        multiline
        onSave={(title) => title.trim() && update({ title: title.trim() })}
      />

      <div className="facts">
        <button className="fact" onClick={() => run("task.reassigned", { task_id: id, owner_email: task.owner_email === me.email ? me.other?.email : me.email })}>
          <span className="fact-label">Owner</span>
          <span>{nameFor(task.owner_email)}</span>
        </button>
        <label className="fact">
          <span className="fact-label">Due</span>
          <span className="tnum">{task.due_date ? formatDue(task.due_date) : "Not set"}</span>
          <input
            type="date"
            className="fact-input"
            value={task.due_date ?? ""}
            onChange={(e) => update({ due_date: e.target.value || null })}
          />
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
        onSave={(description) => update({ description: description.trim() })}
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
          onAdd={(text) =>
            run("item.added", {
              task_id: id,
              item_id: newId(),
              text,
              position: between(live.at(-1)?.position ?? null, null),
            })
          }
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
        <AddLine placeholder="Add a note" multiline onAdd={(body) => run("note.added", { task_id: id, note_id: newId(), body })} />
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
              void run(type, { task_id: id });
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
