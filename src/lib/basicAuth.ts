const BASIC_AUTH_STORAGE_KEY = "jedflix.basicAuth";
const BASIC_AUTH_IDB_NAME = "jedflix-basic-auth";
const BASIC_AUTH_IDB_STORE = "credentials";
const BASIC_AUTH_IDB_KEY = "current";

export type BasicAuthCredentials = {
  username: string;
  password: string;
};

export const BASIC_AUTH_REQUIRED_EVENT = "jedflix:basic-auth-required";

function encodeBasicAuth(username: string, password: string): string {
  return btoa(`${username}:${password}`);
}

export function getBasicAuthCredentials(): BasicAuthCredentials | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(BASIC_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as BasicAuthCredentials;
    if (!parsed.username || !parsed.password) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getBasicAuthHeader(): string | null {
  const credentials = getBasicAuthCredentials();
  if (!credentials) {
    return null;
  }
  return `Basic ${encodeBasicAuth(credentials.username, credentials.password)}`;
}

export function hasBasicAuthCredentials(): boolean {
  return getBasicAuthCredentials() !== null;
}

export async function saveBasicAuthCredentials(credentials: BasicAuthCredentials): Promise<void> {
  localStorage.setItem(BASIC_AUTH_STORAGE_KEY, JSON.stringify(credentials));
  await syncBasicAuthToIndexedDB();
}

export function clearBasicAuthCredentials(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(BASIC_AUTH_STORAGE_KEY);
  void clearBasicAuthFromIndexedDB();
}

export function notifyBasicAuthRequired(): void {
  window.dispatchEvent(new Event(BASIC_AUTH_REQUIRED_EVENT));
}

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

export async function syncBasicAuthToIndexedDB(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  const credentials = getBasicAuthCredentials();
  const db = await openBasicAuthDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BASIC_AUTH_IDB_STORE, "readwrite");
    const store = tx.objectStore(BASIC_AUTH_IDB_STORE);
    if (credentials) {
      store.put(credentials, BASIC_AUTH_IDB_KEY);
    } else {
      store.delete(BASIC_AUTH_IDB_KEY);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
  db.close();
}

async function clearBasicAuthFromIndexedDB(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  const db = await openBasicAuthDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BASIC_AUTH_IDB_STORE, "readwrite");
    tx.objectStore(BASIC_AUTH_IDB_STORE).delete(BASIC_AUTH_IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
  db.close();
}

export function needsBasicAuthForUrl(url: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}
