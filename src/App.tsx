import { useCallback, useEffect, useState } from "react";
import { getActivity, getMe, getTasks, mutate, newId, search, VIEWS, type ActivityEvent, type Me, type TaskRow, type View } from "./api";
import { formatDue, today } from "./dates";
import History from "./History";
import TaskDetail from "./TaskDetail";

const LABELS: Record<View, string> = { open: "Open", mine: "Mine", theirs: "Theirs", done: "Done", archived: "Archived" };

type Route = { name: "list" } | { name: "task"; id: string } | { name: "activity" } | { name: "search" };

function readHash(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("t/")) return { name: "task", id: hash.slice(2) };
  if (hash === "activity") return { name: "activity" };
  if (hash === "search") return { name: "search" };
  return { name: "list" };
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [route, setRoute] = useState<Route>(readHash);
  const [view, setView] = useState<View>("open");
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    getMe().then(setMe, (e: Error) => setError(e.message));
    const onHash = () => setRoute(readHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const load = useCallback(() => {
    getTasks(view).then(setTasks, (e: Error) => setError(e.message));
  }, [view]);

  useEffect(() => {
    if (me?.name && route.name === "list") load();
  }, [me?.name, route.name, load]);

  if (error && !me) return <p className="shell error">{error}</p>;
  if (!me) return null;
  if (!me.name) return <NameGate email={me.email} onNamed={(name) => setMe({ ...me, name })} />;

  const nameFor = (email: string) => (email === me.email ? (me.name ?? "Me") : (me.other?.name ?? email));
  const go = (hash: string) => {
    location.hash = hash;
    setMenu(false);
  };

  if (route.name === "task") {
    return <TaskDetail id={route.id} me={me} onBack={() => go("/")} onChanged={load} />;
  }
  if (route.name === "activity") return <Activity nameFor={nameFor} onBack={() => go("/")} />;
  if (route.name === "search") return <Search nameFor={nameFor} onBack={() => go("/")} />;

  return (
    <>
      <div className="shell">
        <header className="masthead">
          <div className="masthead-row">
            <h1 className="wordmark">Tandem</h1>
            <button className="quiet" onClick={() => setMenu(true)}>
              Menu
            </button>
          </div>
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
          <TaskRows tasks={tasks} nameFor={nameFor} />
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
      {menu && <Menu me={me} onClose={() => setMenu(false)} go={go} />}
    </>
  );
}

function TaskRows({ tasks, nameFor }: { tasks: TaskRow[]; nameFor: (email: string) => string }) {
  return (
    <>
      {tasks.map((t) => (
        <a className={t.completed_at ? "row row-done" : "row"} key={t.id} href={`#/t/${t.id}`}>
          {t.unread ? <span className="mark" aria-label="Unread" /> : null}
          <h2 className="row-title">{t.title}</h2>
          <p className="row-meta tnum">
            <span>{nameFor(t.owner_email)}</span>
            {t.due_date && (
              <span className={!t.completed_at && !t.archived_at && t.due_date < today() ? "overdue" : undefined}>{formatDue(t.due_date)}</span>
            )}
            {t.priority === "high" && !t.completed_at && <span>High</span>}
          </p>
        </a>
      ))}
    </>
  );
}

function Activity({ nameFor, onBack }: { nameFor: (email: string) => string; onBack: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getActivity().then((r) => setEvents(r.events), (e: Error) => setError(e.message));
  }, []);
  return (
    <div className="shell">
      <header className="masthead">
        <button className="back" onClick={onBack}>
          ← Back
        </button>
        <h1 className="wordmark">Activity</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {events && events.length === 0 && <p className="notice">Nothing has happened yet.</p>}
      {events && <History events={events} nameFor={nameFor} itemText={() => "an item"} taskTitle={(e) => (e as ActivityEvent).task_title} />}
    </div>
  );
}

function Search({ nameFor, onBack }: { nameFor: (email: string) => string; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    search(q.trim()).then(setResults, (err: Error) => setError(err.message));
  }

  return (
    <div className="shell">
      <header className="masthead">
        <button className="back" onClick={onBack}>
          ← Back
        </button>
        <form onSubmit={submit}>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" autoFocus />
        </form>
      </header>
      {error && <p className="error">{error}</p>}
      {results && (results.length === 0 ? <p className="notice">Nothing matches.</p> : <TaskRows tasks={results} nameFor={nameFor} />)}
    </div>
  );
}

function Menu({ me, onClose, go }: { me: Me; onClose: () => void; go: (hash: string) => void }) {
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <button className="menu-item" onClick={() => go("/activity")}>
          Activity
        </button>
        <button className="menu-item" onClick={() => go("/search")}>
          Search
        </button>
        <a className="menu-item" href="/api/export.json">
          Export everything as JSON
        </a>
        <a className="menu-item" href="/api/export.csv">
          Export tasks as CSV
        </a>
        <p className="menu-foot tnum">
          {me.email} · {__APP_VERSION__}
        </p>
        <div className="sheet-actions">
          <button className="button button-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
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
