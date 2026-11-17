import { useCallback, useEffect, useState } from "react";
import { getMe, getTasks, mutate, newId, VIEWS, type Me, type TaskRow, type View } from "./api";

const LABELS: Record<View, string> = {
  open: "Open",
  mine: "Mine",
  theirs: "Theirs",
  done: "Done",
  archived: "Archived",
};

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the viewer's zone

function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<View>("open");
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    getMe().then(setMe, (e: Error) => setError(e.message));
  }, []);

  const load = useCallback(() => {
    setTasks(null);
    getTasks(view).then(setTasks, (e: Error) => setError(e.message));
  }, [view]);

  useEffect(() => {
    if (me?.name) load();
  }, [me?.name, load]);

  if (error && !me) return <p className="shell error">{error}</p>;
  if (!me) return null;
  if (!me.name) return <NameGate email={me.email} onNamed={(name) => setMe({ ...me, name })} />;

  const nameFor = (email: string) => (email === me.email ? "Me" : (me.other?.name ?? email));

  return (
    <>
      <div className="shell">
        <header className="masthead">
          <h1 className="wordmark">Tandem</h1>
          <nav className="views">
            {VIEWS.map((v) => (
              <button key={v} className="view" aria-current={v === view} onClick={() => setView(v)}>
                {LABELS[v]}
              </button>
            ))}
          </nav>
        </header>

        {error && <p className="error">{error}</p>}
        {tasks === null ? null : tasks.length === 0 ? (
          <p className="notice">{view === "open" ? "Nothing open. Add the first task." : "Nothing here."}</p>
        ) : (
          tasks.map((t) => (
            <article key={t.id} className={t.completed_at ? "row row-done" : "row"}>
              {t.unread ? <span className="mark" aria-label="Unread" /> : null}
              <h2 className="row-title">{t.title}</h2>
              <p className="row-meta tnum">
                <span>{nameFor(t.owner_email)}</span>
                {t.due_date && (
                  <span className={!t.completed_at && !t.archived_at && t.due_date < today() ? "overdue" : undefined}>
                    {formatDue(t.due_date)}
                  </span>
                )}
                {t.priority === "high" && !t.completed_at && <span>High</span>}
              </p>
            </article>
          ))
        )}
      </div>

      <button className="compose" onClick={() => setComposing(true)}>
        New task
      </button>
      {composing && (
        <NewTask
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            load();
          }}
        />
      )}
    </>
  );
}

function NameGate({ email, onNamed }: { email: string; onNamed: (name: string) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await mutate("user.named", { name: name.trim() });
      onNamed(name.trim());
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="shell" onSubmit={save} style={{ paddingTop: "var(--space-8)" }}>
      <h1 className="wordmark">Tandem</h1>
      <p className="notice">Your name goes on every change you make. Signed in as {email}.</p>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus maxLength={80} />
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button className="button" disabled={!name.trim() || saving}>
          Continue
        </button>
      </div>
    </form>
  );
}

function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await mutate("task.created", { task_id: newId(), title: title.trim() });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={save}>
        <h2 className="wordmark">New task</h2>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing" autoFocus maxLength={200} />
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={!title.trim() || saving}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
