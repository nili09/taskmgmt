/*
 * Keeps the app itself available with no signal. The record lives in IndexedDB, not here, and
 * API calls are never cached: a stale answer would be worse than none. A sign-in redirect is
 * never stored either, or the app would come back as the sign-in page.
 */
const CACHE = "tandem-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim()),
  );
});

const cacheable = (res) => res && res.ok && !res.redirected && res.type === "basic";

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // The app itself: fresh when there is a line, the stored copy when there is not.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (cacheable(res)) caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Everything else — scripts, styles, the typeface: stored copy first, refreshed behind it.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const live = fetch(e.request)
        .then((res) => {
          if (cacheable(res)) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? live;
    }),
  );
});

/*
 * A push carries nothing. The words come from asking the API what changed, so no detail about
 * a task is handed to a push service.
 */
function describe(e) {
  const who = e.actor_name || "They";
  switch (e.type) {
    case "task.created":
      return `${who} added this task`;
    case "task.completed":
      return `${who} completed it`;
    case "task.reopened":
      return `${who} reopened it`;
    case "task.reassigned":
      return `${who} changed who owns it`;
    case "note.added":
      return `${who} added a note`;
    default:
      return `${who} made a change`;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let title = "Tandem";
      let body = "Something changed";
      let data = {};
      try {
        const res = await fetch("/api/activity?limit=1", { credentials: "same-origin" });
        if (res.ok && !res.redirected) {
          const latest = (await res.json()).events[0];
          if (latest) {
            title = latest.task_title || "Tandem";
            body = describe(latest);
            data = { task_id: latest.task_id };
          }
        }
      } catch {
        /* show the plain words instead */
      }
      await self.registration.showNotification(title, { body, data, tag: "tandem", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.task_id ? `/#/t/${event.notification.data.task_id}` : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(path);
          return client.focus();
        }
      }
      return self.clients.openWindow(path);
    }),
  );
});
