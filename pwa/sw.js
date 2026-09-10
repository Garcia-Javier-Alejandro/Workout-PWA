// Service Worker: caches the app shell so the interface and the recording of a
// full session work offline. API calls to the Worker are never cached; they go
// straight to the network (and fail gracefully offline — the session is kept
// locally in IndexedDB and synced later).

const CACHE = "workout-pwa-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./routine.js",
  "./db.js",
  "./api.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin app-shell requests; let API and other origins pass.
  if (url.origin !== self.location.origin) return;

  // Cache-first for the app shell.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});
