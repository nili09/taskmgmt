import type { EventRecord, EventType } from "../shared/model";
import { applyEvent, emptyState, type State } from "../shared/reduce";
import { getMe, markRead, newId, request, type Me } from "./api";

export { newId as newTaskId };
import { provisionalEvent, type Outgoing } from "./pending";

/**
 * The device's own copy of the record. Every event ever pulled is kept, and current state is
 * the shared reducer run over them, so the client and the server agree by construction.
 * Writes go to the outbox first, are shown at once, and are sent in order when there is a line.
 */
export interface Snapshot {
  state: State;
  events: EventRecord[];
  cursors: Record<string, number>;
  me: Me | null;
  cursor: number;
  queued: number;
  online: boolean;
  syncedAt: string | null;
}

let snapshot: Snapshot = {
  state: emptyState(),
  events: [],
  cursors: {},
  me: null,
  cursor: 0,
  queued: 0,
  online: navigator.onLine,
  syncedAt: null,
};
const listeners = new Set<() => void>();

export const getSnapshot = () => snapshot;
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const fn of listeners) fn();
}

// --- IndexedDB -------------------------------------------------------------

const DB = "tandem";
let db: IDBDatabase | null = null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("events", { keyPath: "seq" });
      d.createObjectStore("outbox", { keyPath: "id" });
      d.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db!.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const putAll = (store: string, rows: unknown[]) =>
  new Promise<void>((resolve, reject) => {
    const t = db!.transaction(store, "readwrite");
    const s = t.objectStore(store);
    for (const row of rows) s.put(row as any);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });

// --- Deriving state --------------------------------------------------------

let synced: EventRecord[] = [];
let outbox: Outgoing[] = [];

function rebuild() {
  const pending = outbox
    .map((m, i) => provisionalEvent(m, { email: snapshot.me?.email ?? "", name: snapshot.me?.name ?? null }, i, synced))
    .filter((e): e is EventRecord => e !== null);
  const events = [...synced, ...pending];
  const state = emptyState();
  for (const e of events) {
    // A queued edit can arrive before the thing it edits, so never let one event stop the rest.
    try {
      applyEvent(state, e);
    } catch {
      /* skipped */
    }
  }
  publish({ state, events, queued: outbox.length, cursor: synced.at(-1)?.seq ?? snapshot.cursor });
}

// --- Syncing ---------------------------------------------------------------

export async function pull(): Promise<void> {
  if (!db) return;
  try {
    for (;;) {
      const after = snapshot.cursor;
      const page = await request<{ events: EventRecord[]; cursor: number; more: boolean }>(`/api/events?after=${after}&limit=500`);
      if (page.events.length) {
        await putAll("events", page.events);
        synced = [...synced, ...page.events];
        await tx("meta", "readwrite", (s) => s.put(page.cursor, "cursor"));
        publish({ cursor: page.cursor });
      } else {
        publish({ cursor: page.cursor });
      }
      if (!page.more) break;
    }
    const cursors = await request<Record<string, number>>("/api/read-cursors");
    publish({ cursors, online: true, syncedAt: new Date().toISOString() });
    rebuild();
  } catch {
    publish({ online: false });
  }
}

/** Send what is queued, oldest first. Stops at the first failure and keeps its place. */
export async function flush(): Promise<void> {
  if (!db || !outbox.length) return;
  for (const m of [...outbox]) {
    try {
      await request("/api/mutations", { method: "POST", body: JSON.stringify(m) });
    } catch {
      publish({ online: false });
      return;
    }
    outbox = outbox.filter((o) => o.id !== m.id);
    await tx("outbox", "readwrite", (s) => s.delete(m.id));
  }
  rebuild();
  await pull();
}

/** Queue one change: shown at once, sent when there is a line. */
export async function apply(type: EventType, payload: Record<string, unknown>): Promise<void> {
  const m: Outgoing = { id: newId(), type, client_at: new Date().toISOString(), payload };
  outbox = [...outbox, m];
  await putAll("outbox", [m]);
  rebuild();
  await flush();
}

export async function markTaskRead(taskId: string): Promise<void> {
  const last = synced.filter((e) => e.task_id === taskId).at(-1);
  if (!last) return;
  if ((snapshot.cursors[taskId] ?? 0) >= last.seq) return;
  publish({ cursors: { ...snapshot.cursors, [taskId]: last.seq } });
  try {
    await markRead(taskId, last.seq);
  } catch {
    /* the next pull will set it right */
  }
}

// --- Start -----------------------------------------------------------------

export async function init(): Promise<void> {
  db = await open();
  synced = (await tx<EventRecord[]>("events", "readonly", (s) => s.getAll())).sort((a, b) => a.seq - b.seq);
  outbox = await tx<Outgoing[]>("outbox", "readonly", (s) => s.getAll());
  const cursor = (await tx<number | undefined>("meta", "readonly", (s) => s.get("cursor"))) ?? 0;
  const savedMe = await tx<Me | undefined>("meta", "readonly", (s) => s.get("me"));
  publish({ cursor, me: savedMe ?? null });
  rebuild();

  try {
    const me = await getMe();
    await tx("meta", "readwrite", (s) => s.put(me, "me"));
    publish({ me, online: true });
  } catch {
    publish({ online: false });
  }

  await flush();
  await pull();

  addEventListener("online", () => void flush());
  addEventListener("offline", () => publish({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void pull();
  }, 30_000);
}
