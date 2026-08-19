/** Content type for the served service worker script. */
export const SW_CONTENT_TYPE = "text/javascript";

/** Cache-name prefix; the version suffix retires stale caches on activate. */
export const SW_CACHE_PREFIX = "pace-offline-";

/** Bump when the caching logic changes so old caches are dropped on activate. */
export const SW_CACHE_VERSION = "v1";

/**
 * The pace service worker script, so the installed app (and any regular tab)
 * can show the last-rendered dashboard while the server is unreachable —
 * laptop offline, pace host down, phone in a tunnel. Pure function of the
 * base path: the app shell (dashboard page, stylesheet, client module, icon,
 * manifest) is precached under it, and every same-origin GET is served
 * network-first — the live server always wins, the cache is refreshed from
 * every successful response, and only a failed fetch falls back to the last
 * cached copy (navigations fall back to the cached dashboard page). With the
 * manifest this also satisfies Chrome's PWA installability criteria, so the
 * install prompt is offered instead of the plain "Add to Home screen".
 */
export function serviceWorkerScript(basePath = ""): string {
  const root = basePath === "" ? "/" : basePath;
  return `// pace service worker: offline last-render viewing (network-first).
const CACHE = ${JSON.stringify(SW_CACHE_PREFIX + SW_CACHE_VERSION)};
const ROOT = ${JSON.stringify(root)};
const SHELL = [
  ROOT,
  ${JSON.stringify(`${basePath}/styles.css`)},
  ${JSON.stringify(`${basePath}/dashboard.js`)},
  ${JSON.stringify(`${basePath}/favicon.svg`)},
  ${JSON.stringify(`${basePath}/manifest.webmanifest`)},
];

self.addEventListener("install", (event) => {
  // Best-effort precache: a failing asset must not brick installation.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(${JSON.stringify(SW_CACHE_PREFIX)}) && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Refresh the cache from every successful response so the offline
        // fallback is always the last render the user actually saw.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) =>
          cached
            ?? (request.mode === "navigate" ? caches.match(ROOT) : undefined)
            ?? Response.error(),
        ),
      ),
  );
});
`;
}
