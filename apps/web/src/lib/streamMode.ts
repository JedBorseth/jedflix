import type { StreamMode } from "@/lib/streamApi";
import { getUserSettings, saveUserSettings, subscribeUserSettings } from "@/lib/userSettings";

export function getStreamMode(): StreamMode {
  return getUserSettings().streamMode ?? "proxy";
}

export function setStreamMode(mode: StreamMode) {
  saveUserSettings({ streamMode: mode });
}

export function subscribeStreamMode(onChange: (mode: StreamMode) => void) {
  return subscribeUserSettings((settings) => onChange(settings.streamMode ?? "proxy"));
}
