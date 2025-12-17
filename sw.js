/* Simple offline cache for the game (PWA). */

const CACHE_NAME = "dungeon-roguelike-v2";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./investigation_descriptions.js",
  "./js/version.js",
  "./js/state.js",
  "./js/data.js",
  "./js/helpers.js",
  "./js/mapgen.js",
  "./js/enemy_ai.js",
  "./js/player.js",
  "./js/inventory.js",
  "./js/draw.js",
  "./js/inputs.js",
  "./js/init.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
      ),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: prefer cached app shell, fall back to network.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cached) => cached || fetch(req))
    );
    return;
  }

  // Cache-first for static assets; update cache in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          // Only cache successful basic responses.
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
