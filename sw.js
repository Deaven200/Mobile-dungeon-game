/* Simple offline cache for the game (PWA). */

const CACHE_NAME = "dungeon-roguelike-v1061";

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

self.addEventListener("message", (event) => {
  const msg = event?.data;
  if (msg && msg.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: NETWORK-FIRST (always try newest), fall back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update cached app shell in background.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: NETWORK-FIRST (newest), fall back to cache (offline).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
