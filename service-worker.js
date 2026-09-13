/*
 * Keep the app usable without a connection, but never let the Cache Storage
 * copy hide a responsive newer deployment. Every same-origin GET is requested
 * from the server first with the browser HTTP cache bypassed. Cached content is
 * used only when that request fails or takes longer than NETWORK_TIMEOUT_MS.
 */
const CACHE_NAME = "fifteen-puzzle-app-shell";
const NETWORK_TIMEOUT_MS = 3000;
const APP_SHELL_URL = new URL("./", self.registration.scope).href;
const INDEX_URL = new URL("index.html", self.registration.scope).href;
const APP_SHELL = [
  APP_SHELL_URL,
  INDEX_URL,
  new URL("styles.css", self.registration.scope).href,
  new URL("app.js", self.registration.scope).href,
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(APP_SHELL.map(async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not cache ${url}: ${response.status}`);
    await cache.put(url, response);
  }));
}

async function cacheResponse(request, response) {
  if (!response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    // "no-store" also avoids a stale entry in the browser's HTTP cache.
    return await fetch(request, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function cachedFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  if (request.mode === "navigate") {
    return (await cache.match(APP_SHELL_URL)) ||
      (await cache.match(INDEX_URL)) ||
      new Response("The app is unavailable offline until it has been opened once online.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
  }

  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Let the browser handle analytics and other cross-origin requests normally.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetchWithTimeout(request);

      if (response.ok) {
        // Write before responding so the next offline request has the fresh
        // copy available. A cache-write failure must not block the live app.
        await cacheResponse(request, response).catch(() => {});
        return response;
      }

      // A real client error, such as a missing path, should not be replaced by
      // an older cached page. For temporary server failures, use the app copy.
      if (response.status < 500) return response;
    } catch {
      // The cache fallback below handles offline and timed-out requests.
    }

    return cachedFallback(request);
  })());
});
