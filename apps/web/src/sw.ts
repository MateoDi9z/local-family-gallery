/// <reference lib="webworker" />
// Service worker (injectManifest): precachea el shell, cachea miniaturas y recibe lo compartido
// desde Android (Web Share Target). Nunca cachea originales ni videos.
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { SHARE_CACHE, SHARE_FIELD, SHARE_PATH } from "./share";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// Miniaturas: URLs inmutables, así que CacheFirst con tope de entradas.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    /^\/api\/files\/[^/]+\/thumb\.webp$/.test(url.pathname),
  new CacheFirst({
    cacheName: "lfg-thumbs",
    plugins: [new ExpirationPlugin({ maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 365, purgeOnQuotaError: true })],
  }),
);

// Web Share Target: guardar los archivos y mandar a /compartir, que los sube solos.
registerRoute(
  ({ url, request }) => request.method === "POST" && url.pathname === SHARE_PATH,
  async ({ request }) => {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    let i = 0;
    for (const f of form.getAll(SHARE_FIELD)) {
      if (!(f instanceof File)) continue;
      await cache.put(
        new Request(`/__compartido/${stamp}-${i++}`),
        new Response(f, {
          headers: {
            "content-type": f.type,
            "x-name": encodeURIComponent(f.name),
            "x-last-modified": String(f.lastModified),
          },
        }),
      );
    }
    return Response.redirect(SHARE_PATH, 303);
  },
  "POST",
);
