import { request } from "./api";

/**
 * Web Push, asked for only when the person taps for it. The push itself carries nothing: the
 * service worker asks the API what changed and writes the notification from the real record.
 */
export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on";

const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const iPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export async function pushState(key: string | null): Promise<PushState> {
  if (!key || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    // On an iPhone, push exists only once the app is on the home screen.
    return iPhone() && !installed() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const part = (sub: PushSubscription, name: "p256dh" | "auth") => {
  const raw = sub.getKey(name);
  return raw ? btoa(String.fromCharCode(...new Uint8Array(raw))) : "";
};

export async function enablePush(key: string): Promise<PushState> {
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
  await request("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: sub.endpoint, p256dh: part(sub, "p256dh"), auth: part(sub, "auth") }),
  });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await request("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}
