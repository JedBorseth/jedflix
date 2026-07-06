/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

const handler = createHandlerBoundToURL("/index.html");
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/stream-api/],
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

const BASIC_AUTH_IDB_NAME = "jedflix-basic-auth";
const BASIC_AUTH_IDB_STORE = "credentials";
const BASIC_AUTH_IDB_KEY = "current";

type BasicAuthCredentials = {
  username: string;
  password: string;
};

function openBasicAuthDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASIC_AUTH_IDB_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BASIC_AUTH_IDB_STORE)) {
        db.createObjectStore(BASIC_AUTH_IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function getBasicAuthHeaderFromIdb(): Promise<string | null> {
  try {
    const db = await openBasicAuthDb();
    const credentials = await new Promise<BasicAuthCredentials | null>((resolve, reject) => {
      const tx = db.transaction(BASIC_AUTH_IDB_STORE, "readonly");
      const request = tx.objectStore(BASIC_AUTH_IDB_STORE).get(BASIC_AUTH_IDB_KEY);
      request.onsuccess = () => resolve((request.result as BasicAuthCredentials | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
    db.close();

    if (!credentials?.username || !credentials.password) {
      return null;
    }

    const encoded = btoa(`${credentials.username}:${credentials.password}`);
    return `Basic ${encoded}`;
  } catch {
    return null;
  }
}

function isSameOriginRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" && event.request.method !== "HEAD") {
    return;
  }

  if (!isSameOriginRequest(event.request)) {
    return;
  }

  event.respondWith(
    (async () => {
      const authHeader = await getBasicAuthHeaderFromIdb();
      if (!authHeader) {
        return fetch(event.request);
      }

      const headers = new Headers(event.request.headers);
      headers.set("Authorization", authHeader);
      const authedRequest = new Request(event.request, { headers });
      return fetch(authedRequest);
    })(),
  );
});
