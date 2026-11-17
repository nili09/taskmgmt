import { importJWK, SignJWT } from "jose";
import type { EventRecord } from "../shared/model";
import type { Env } from "./env";

/**
 * Web Push with VAPID, and no payload. The notification's words come from the service worker
 * asking the API what changed, so nothing about a task is encrypted, sent to a push service or
 * stored on it. The key pair is generated on the owner's machine; only the public half is config.
 */
const NOTIFY = new Set(["task.created", "task.completed", "task.reopened", "task.reassigned", "note.added"]);

async function vapidHeader(env: Env, endpoint: string): Promise<string | null> {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT) return null;
  const key = await importJWK(JSON.parse(env.VAPID_PRIVATE_JWK), "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(new URL(endpoint).origin)
    .setSubject(env.VAPID_SUBJECT)
    .setExpirationTime("12h")
    .sign(key);
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

interface Subscription {
  endpoint: string;
  email: string;
}

/** Tell the other person. Never the person who made the change. */
export async function notify(env: Env, event: EventRecord): Promise<void> {
  if (!NOTIFY.has(event.type)) return;
  const { results } = await env.DB.prepare("SELECT endpoint, email FROM push_subscriptions WHERE email != ?")
    .bind(event.actor_email)
    .all<Subscription>();

  for (const sub of results) {
    const authorization = await vapidHeader(env, sub.endpoint);
    if (!authorization) return;
    try {
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: { Authorization: authorization, TTL: "86400", "Content-Length": "0", Urgency: "normal" },
      });
      // The subscription is gone: the person cleared the app or the browser dropped it.
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
      }
    } catch {
      /* a push service that cannot be reached is not worth failing a save over */
    }
  }
}
