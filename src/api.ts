import type { EventRecord, EventType, Task } from "../shared/model";

export type TaskRow = Task & { unread: 0 | 1 };
export type Me = { email: string; name: string | null; other: { email: string; name: string | null } | null };
export const VIEWS = ["open", "mine", "theirs", "done", "archived"] as const;
export type View = (typeof VIEWS)[number];

/** A sortable id, generated here so a task made offline keeps the id it was given. UUID v7. */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * An expired Access session answers an API call with a redirect to sign-in. Reload the whole
 * page so the browser follows it; the request never resolves into the app.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      redirect: "manual",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("No connection");
  }
  if (res.status === 401 || res.status === 403 || res.type === "opaqueredirect") {
    location.reload();
    throw new Error("Signed out");
  }
  const data = (await res.json().catch(() => null)) as T | { error: string } | null;
  if (!res.ok) throw new Error(data && "error" in (data as object) ? (data as { error: string }).error : "Something went wrong");
  return data as T;
}

export const getMe = () => request<Me>("/api/me");
export const getTasks = (view: View) => request<TaskRow[]>(`/api/tasks?view=${view}`);

export function mutate(type: EventType, payload: unknown) {
  return request<{ event: EventRecord; replayed: boolean }>("/api/mutations", {
    method: "POST",
    body: JSON.stringify({ id: newId(), type, client_at: new Date().toISOString(), payload }),
  });
}
