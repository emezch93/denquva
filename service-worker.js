const CACHE_NAME = "duka-shell-v10";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/app.css",
  "./css/tailwind.css",
  "./js/app.js",
  "./manifest.json",
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
      const response = await fetch(file, { redirect: "follow" });
      const clean = stripRedirect(response);
      await cache.put(file, clean);
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
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls. If offline, let the app show its own error state
  // instead of pretending a request succeeded.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => stripRedirect(response));
    })
  );
});
