const CACHE_NAME = "denquva-shell-v11";
const RUNTIME_CACHE = "denquva-runtime-v5";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/app.css",
  "./css/tailwind.css",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
// Third party assets worth keeping for fast and offline starts.
const RUNTIME_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
];

function stripRedirect(response) {
  if (response && response.redirected) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}

async function cacheShell(cache) {
  await Promise.all(
    SHELL_FILES.map(async (file) => {
      try {
        const response = await fetch(file, { redirect: "follow", cache: "reload" });
        if (response.ok) await cache.put(file, stripRedirect(response));
      } catch {
        // One failed file should not block the install.
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cacheShell));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// Serve from cache instantly, refresh the cache in the background.
async function staleWhileRevalidate(event, cacheName, cacheKey, fetchTarget) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheKey);

  const network = fetch(fetchTarget)
    .then((response) => {
      if (response && response.status !== 206 && (response.ok || response.type === "opaque")) {
        const clean = stripRedirect(response);
        cache.put(cacheKey, clean.clone()).catch(() => {});
        return clean;
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  return fresh || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !RUNTIME_HOSTS.includes(url.hostname)) return; // API and everything else goes straight to network

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(event, CACHE_NAME, "./index.html", "./index.html"));
    return;
  }
  event.respondWith(
    staleWhileRevalidate(event, sameOrigin ? CACHE_NAME : RUNTIME_CACHE, request, request)
  );
});
