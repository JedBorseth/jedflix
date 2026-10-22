/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

// Custom workers must activate updates explicitly for registerType: "autoUpdate".
void self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

const handler = createHandlerBoundToURL("/index.html");
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/backend/, /^\/stream-api/],
});
registerRoute(navigationRoute);

registerRoute(
  ({ url }) => url.hostname === "image.tmdb.org",
  new CacheFirst({
    cacheName: "tmdb-images",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);
