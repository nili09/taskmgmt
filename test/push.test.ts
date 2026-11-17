import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { ALEX, as, SAM, uid } from "./helpers";

/**
 * Push carries no payload: it is a nudge, and the service worker asks what changed. So what
 * matters here is who gets nudged, who does not, and that a dead subscription is cleaned up.
 */
const keys = await generateKeyPair("ES256", { extractable: true });
const vapid = {
  VAPID_PUBLIC_KEY: "BPublicKeyForTests",
  VAPID_PRIVATE_JWK: JSON.stringify(await exportJWK(keys.privateKey)),
  VAPID_SUBJECT: "mailto:owner@example.test",
};

const ENDPOINT = "https://push.example.test/subscription-1";

/** Watch the push service while leaving the rest of the stubbed world alone. */
function watchPush(status = 201) {
  const inner = globalThis.fetch;
  const calls: { url: string; authorization: string | null }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://push.example.test/")) {
      calls.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
      return new Response(null, { status });
    }
    return inner(input, init);
  });
  return calls;
}

async function subscribe(who: ReturnType<typeof as>, endpoint = ENDPOINT) {
  const res = await who.post("/api/push/subscribe", { endpoint, p256dh: "key", auth: "secret" });
  expect(res.status).toBe(200);
}

const rows = async () => (await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all()).results;

describe("push", () => {
  it("nudges the other person, and never the one who made the change", async () => {
    const calls = watchPush();
    await subscribe(as(SAM));
    await subscribe(as(ALEX), "https://push.example.test/alex");

    const res = await as(ALEX).mutate("task.created", { task_id: uid(), title: "Something" }, {}, vapid);
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe(ENDPOINT);
    expect(calls[0].authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=BPublicKeyForTests$/);
  });

  it("says nothing about a checklist tick", async () => {
    const calls = watchPush();
    await subscribe(as(SAM));
    const task = uid();
    const item = uid();
    await as(ALEX).mutate("task.created", { task_id: task, title: "Something" }, {}, vapid);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await as(ALEX).mutate("item.added", { task_id: task, item_id: item, text: "Tick me", position: "i" }, {}, vapid);
    await as(ALEX).mutate("item.ticked", { item_id: item }, {}, vapid);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(1);
  });

  it("forgets a subscription the push service says is gone", async () => {
    const calls = watchPush(410);
    await subscribe(as(SAM));
    await as(ALEX).mutate("task.created", { task_id: uid(), title: "Something" }, {}, vapid);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await vi.waitFor(async () => expect(await rows()).toHaveLength(0));
  });

  it("sends nothing when no key pair is configured", async () => {
    const calls = watchPush();
    await subscribe(as(SAM));
    await as(ALEX).mutate("task.created", { task_id: uid(), title: "Something" }, {});
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    expect(await rows()).toHaveLength(1);
  });
});
