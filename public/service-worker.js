const CACHE_NAME = "entre-amigos-v12-0-9b";

const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Auth y API: siempre red. Nunca cachear sesiones ni respuestas privadas.
  if (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/")
    )
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML, JS, CSS y manifest: NETWORK FIRST.
  // Así un deploy nuevo no puede quedar mezclado con assets viejos.
  if (
    request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/app.js" ||
    url.pathname === "/styles.css" ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, copy));

          return response;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match("/index.html"))
        )
    );

    return;
  }

  // Íconos y demás estáticos: cache-first.
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request))
  );
});
