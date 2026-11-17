import { useEffect, useState, useSyncExternalStore } from "react";
import { VIEWS, type Me, type View } from "./api";
import { formatDue, today } from "./dates";
import History from "./History";
import { activityFor, searchTasks, tasksFor, titleOf, type TaskRow } from "./select";
import { disablePush, enablePush, pushState, type PushState } from "./push";
import { apply, getSnapshot, init, newTaskId, subscribe, type Snapshot } from "./store";
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

export function nameOf(s: Snapshot, email: string): string {
  return s.state.names[email] ?? (email === s.me?.email ? s.me.name : (s.me?.other?.name ?? null)) ?? email;
}

export default function App() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const [route, setRoute] = useState<Route>(readHash);
  const [view, setView] = useState<View>("open");
  const [ready, setReady] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menu, setMenu] = useState(false);

  const unread = tasksFor(s, "open").filter((t) => t.unread).length;
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    void (unread ? nav.setAppBadge(unread) : nav.clearAppBadge?.()).catch(() => {});
  }, [unread]);

  useEffect(() => {
    init().finally(() => setReady(true));
    const onHash = () => setRoute(readHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  if (!ready) return null;
  if (!s.me) return <p className="shell notice">Not signed in. Reload the page.</p>;
  const myName = s.state.names[s.me.email] ?? s.me.name;
  if (!myName) return <NameGate email={s.me.email} />;

  const nameFor = (email: string) => (email === s.me!.email ? myName : nameOf(s, email));
  const go = (hash: string) => {
    location.hash = hash;
    setMenu(false);
  };

  if (route.name === "task") return <TaskDetail id={route.id} nameFor={nameFor} onBack={() => go("/")} />;
  if (route.name === "activity")
    return (
      <div className="shell">
        <header className="masthead">
          <button className="back" onClick={() => go("/")}>
            ← Back
          </button>
          <h1 className="wordmark">Activity</h1>
        </header>
        <History events={activityFor(s)} nameFor={nameFor} itemText={(id) => s.state.items[id]?.text ?? "an item"} taskTitle={(e) => titleOf(s, e)} />
      </div>
    );
  if (route.name === "search") return <Search s={s} nameFor={nameFor} onBack={() => go("/")} />;

  const tasks = tasksFor(s, view);
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

        <Status s={s} />
        {tasks.length === 0 ? (
          <p className="notice">{view === "open" ? "Nothing open. Add the first task." : "Nothing here."}</p>
        ) : (
          <TaskRows tasks={tasks} nameFor={nameFor} />
        )}
      </div>

      <button className="compose" onClick={() => setComposing(true)}>
        New task
      </button>
      {composing && <NewTask me={s.me} onClose={() => setComposing(false)} />}
      {menu && <Menu s={s} onClose={() => setMenu(false)} go={go} />}
    </>
  );
}

/** Says what is happening only when something is: offline, or changes still to send. */
function Status({ s }: { s: Snapshot }) {
  if (s.online && !s.queued) return null;
  const waiting = s.queued === 1 ? "1 change waiting to send" : `${s.queued} changes waiting to send`;
  return <p className="status">{s.online ? waiting : s.queued ? `Offline · ${waiting}` : "Offline · showing what you already have"}</p>;
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

function Search({ s, nameFor, onBack }: { s: Snapshot; nameFor: (email: string) => string; onBack: () => void }) {
  const [q, setQ] = useState("");
  const results = searchTasks(s, q);
  return (
    <div className="shell">
      <header className="masthead">
        <button className="back" onClick={onBack}>
          ← Back
        </button>
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" autoFocus />
      </header>
      {q.trim() && (results.length === 0 ? <p className="notice">Nothing matches.</p> : <TaskRows tasks={results} nameFor={nameFor} />)}
    </div>
  );
}

function Menu({ s, onClose, go }: { s: Snapshot; onClose: () => void; go: (hash: string) => void }) {
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <button className="menu-item" onClick={() => go("/activity")}>
          Activity
        </button>
        <button className="menu-item" onClick={() => go("/search")}>
          Search
        </button>
        <PushControl pushKey={s.me?.push_key ?? null} />
        <a className="menu-item" href="/api/export.json">
          Export everything as JSON
        </a>
        <a className="menu-item" href="/api/export.csv">
          Export tasks as CSV
        </a>
        <p className="menu-foot tnum">
          {s.me?.email}
          <br />
          {s.online ? "Up to date" : "Offline"}
          {s.queued ? ` · ${s.queued} to send` : ""} · {__APP_VERSION__}
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

/** Permission is asked for only on a deliberate tap, never on first load. */
function PushControl({ pushKey }: { pushKey: string | null }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState(pushKey).then(setState);
  }, [pushKey]);

  if (!state) return null;
  if (state === "needs-install")
    return <p className="menu-note">Add Tandem to your home screen to get notifications on this phone.</p>;
  if (state === "unsupported") return <p className="menu-note">This browser cannot show notifications.</p>;
  if (state === "blocked") return <p className="menu-note">Notifications are blocked in this browser's settings.</p>;

  return (
    <button
      className="menu-item"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          setState(state === "on" ? await disablePush() : await enablePush(pushKey!));
        } finally {
          setBusy(false);
        }
      }}
    >
      {state === "on" ? "Turn off notifications" : "Turn on notifications"}
    </button>
  );
}

function NameGate({ email }: { email: string }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="shell"
      style={{ paddingTop: "var(--space-8)" }}
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        void apply("user.named", { name: name.trim() });
      }}
    >
      <h1 className="wordmark">Tandem</h1>
      <p className="notice">Your name goes on every change you make. Signed in as {email}.</p>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus maxLength={80} />
      <div className="sheet-actions">
        <button className="button" disabled={!name.trim() || saving}>
          Continue
        </button>
      </div>
    </form>
  );
}

function NewTask({ me, onClose }: { me: Me; onClose: () => void }) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void apply("task.created", { task_id: newTaskId(), title: title.trim(), owner_email: me.email });
          onClose();
        }}
      >
        <h2 className="wordmark">New task</h2>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing" autoFocus maxLength={200} />
        <div className="sheet-actions">
          <button type="button" className="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={!title.trim()}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
