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
