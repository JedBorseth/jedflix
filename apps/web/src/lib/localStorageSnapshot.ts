export function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function createLocalStorageSnapshot<T>(
  key: string,
  eventName: string,
  empty: T,
  parse: (raw: string | null) => T,
) {
  let cachedRaw: string | null = null;
  let cachedSnapshot = empty;

  function getSnapshot(): T {
    if (!canUseStorage()) {
      return empty;
    }
    const raw = window.localStorage.getItem(key);
    if (raw !== cachedRaw) {
      cachedSnapshot = parse(raw);
      cachedRaw = raw;
    }
    return cachedSnapshot;
  }

  function notify() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(eventName));
    }
  }

  function write(snapshot: T): T {
    if (!canUseStorage()) {
      return empty;
    }
    const raw = JSON.stringify(snapshot);
    try {
      window.localStorage.setItem(key, raw);
      if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedSnapshot = snapshot;
      }
    } catch {
      // Quota / private mode — ignore.
    }
    notify();
    return snapshot;
  }

  function subscribe(onStoreChange: () => void) {
    if (typeof window === "undefined") {
      return () => {};
    }
    const handler = () => onStoreChange();
    window.addEventListener("storage", handler);
    window.addEventListener(eventName, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(eventName, handler);
    };
  }

  function reset() {
    cachedRaw = null;
    cachedSnapshot = empty;
  }

  return { getSnapshot, write, notify, subscribe, reset };
}
