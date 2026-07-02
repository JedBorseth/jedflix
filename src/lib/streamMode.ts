import type { StreamMode } from "@/lib/streamApi";

const STORAGE_KEY = "jedflix.streamMode";

export function getStreamMode(): StreamMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "direct" ? "direct" : "proxy";
}

export function setStreamMode(mode: StreamMode) {
  localStorage.setItem(STORAGE_KEY, mode);
}

export function subscribeStreamMode(onChange: (mode: StreamMode) => void) {
  const handler = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      onChange(getStreamMode());
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
