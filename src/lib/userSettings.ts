import type { StreamMode } from "@/lib/streamApi";

const SETTINGS_STORAGE_KEY = "jedflix.userSettings";
const LEGACY_STREAM_MODE_KEY = "jedflix.streamMode";
const SETTINGS_CHANGED_EVENT = "jedflix:user-settings-changed";

export type ExternalPlayer = "disabled" | "vlc" | "outplayer";

export type UserSettings = {
  realDebridApiKey?: string;
  streamMode?: StreamMode;
  externalPlayer?: ExternalPlayer;
  updatedAt?: number;
};

export function getUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return {};
  }

  const stored = readStoredSettings();
  const legacyMode = localStorage.getItem(LEGACY_STREAM_MODE_KEY);
  if (legacyMode === "direct" || legacyMode === "proxy") {
    const migrated = {
      ...stored,
      streamMode: stored.streamMode ?? legacyMode,
      updatedAt: stored.updatedAt ?? Date.now(),
    };
    writeStoredSettings(migrated);
    localStorage.removeItem(LEGACY_STREAM_MODE_KEY);
    return migrated;
  }

  return stored;
}

export function saveUserSettings(partial: Partial<UserSettings>): UserSettings {
  const current = getUserSettings();
  const next: UserSettings = {
    ...current,
    ...partial,
    updatedAt: partial.updatedAt ?? Date.now(),
  };

  if (Object.prototype.hasOwnProperty.call(partial, "realDebridApiKey") && partial.realDebridApiKey === undefined) {
    delete next.realDebridApiKey;
  }
  if (Object.prototype.hasOwnProperty.call(partial, "streamMode") && partial.streamMode === undefined) {
    delete next.streamMode;
  }
  if (Object.prototype.hasOwnProperty.call(partial, "externalPlayer") && partial.externalPlayer === undefined) {
    delete next.externalPlayer;
  }

  writeStoredSettings(next);
  notifySettingsChanged();
  return next;
}

export function replaceUserSettings(settings: UserSettings): UserSettings {
  const next = {
    ...settings,
    updatedAt: settings.updatedAt ?? Date.now(),
  };
  writeStoredSettings(next);
  notifySettingsChanged();
  return next;
}

export function clearUserSettings() {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  localStorage.removeItem(LEGACY_STREAM_MODE_KEY);
  notifySettingsChanged();
}

export function subscribeUserSettings(onChange: (settings: UserSettings) => void) {
  const handler = (event: StorageEvent) => {
    if (event.key === SETTINGS_STORAGE_KEY || event.key === LEGACY_STREAM_MODE_KEY) {
      onChange(getUserSettings());
    }
  };
  const customHandler = () => onChange(getUserSettings());

  window.addEventListener("storage", handler);
  window.addEventListener(SETTINGS_CHANGED_EVENT, customHandler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SETTINGS_CHANGED_EVENT, customHandler);
  };
}

function readStoredSettings(): UserSettings {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as UserSettings;
    return sanitizeSettings(parsed);
  } catch {
    return {};
  }
}

function writeStoredSettings(settings: UserSettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
}

function sanitizeSettings(settings: UserSettings): UserSettings {
  return {
    realDebridApiKey: settings.realDebridApiKey || undefined,
    streamMode:
      settings.streamMode === "direct" || settings.streamMode === "proxy"
        ? settings.streamMode
        : undefined,
    externalPlayer:
      settings.externalPlayer === "disabled" ||
      settings.externalPlayer === "vlc" ||
      settings.externalPlayer === "outplayer"
        ? settings.externalPlayer
        : undefined,
    updatedAt: typeof settings.updatedAt === "number" ? settings.updatedAt : undefined,
  };
}

function notifySettingsChanged() {
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}
