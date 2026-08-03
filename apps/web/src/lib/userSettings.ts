const SETTINGS_STORAGE_KEY = "jedflix.userSettings";
const LEGACY_STREAM_MODE_KEY = "jedflix.streamMode";
const SETTINGS_CHANGED_EVENT = "jedflix:user-settings-changed";

export type ExternalPlayer = "disabled" | "vlc" | "outplayer";
export type DeviceType = "desktop" | "mobile" | "tv";
export type ContentType = "movies_shows" | "audiobooks" | "music" | "video_games";

export const DEVICE_TYPES: DeviceType[] = ["desktop", "mobile", "tv"];
export const CONTENT_TYPES: ContentType[] = [
  "movies_shows",
  "audiobooks",
  "music",
  "video_games",
];
/** Content types that need a Real Debrid API key. Music does not. */
export const DEBRID_REQUIRED_CONTENT_TYPES: ContentType[] = [
  "movies_shows",
  "audiobooks",
  "video_games",
];
export const EXTERNAL_PLAYERS: ExternalPlayer[] = ["disabled", "vlc", "outplayer"];

export function contentTypeRequiresRealDebrid(type: ContentType): boolean {
  return DEBRID_REQUIRED_CONTENT_TYPES.includes(type);
}

export function hasRealDebridApiKey(settings: UserSettings = getUserSettings()): boolean {
  return typeof settings.realDebridApiKey === "string" && settings.realDebridApiKey.trim().length > 0;
}

export function contentTypesRequiringRealDebrid(contentTypes: ContentType[]): ContentType[] {
  return contentTypes.filter(contentTypeRequiresRealDebrid);
}

export function withoutDebridContentTypes(contentTypes: ContentType[]): ContentType[] {
  return contentTypes.filter((type) => !contentTypeRequiresRealDebrid(type));
}

export type UserSettings = {
  realDebridApiKey?: string;
  externalPlayer?: ExternalPlayer;
  deviceType?: DeviceType;
  contentTypes?: ContentType[];
  letterboxdUsername?: string;
  virusWarningAccepted?: boolean;
  ispWarningAccepted?: boolean;
  onboardingCompleted?: boolean;
  updatedAt?: number;
};

export function getUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return {};
  }

  const stored = readStoredSettings();
  // Drop legacy stream-mode key; playback is direct-only now.
  if (localStorage.getItem(LEGACY_STREAM_MODE_KEY)) {
    localStorage.removeItem(LEGACY_STREAM_MODE_KEY);
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

  clearOptionalField(next, partial, "realDebridApiKey");
  clearOptionalField(next, partial, "externalPlayer");
  clearOptionalField(next, partial, "deviceType");
  clearOptionalField(next, partial, "contentTypes");
  clearOptionalField(next, partial, "letterboxdUsername");
  clearOptionalField(next, partial, "virusWarningAccepted");
  clearOptionalField(next, partial, "ispWarningAccepted");
  clearOptionalField(next, partial, "onboardingCompleted");

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

export function isOnboardingComplete(settings: UserSettings = getUserSettings()): boolean {
  return settings.onboardingCompleted === true && hasRequiredOnboardingFields(settings);
}

export function hasRequiredOnboardingFields(settings: UserSettings): boolean {
  if (
    !isDeviceType(settings.deviceType) ||
    !Array.isArray(settings.contentTypes) ||
    settings.contentTypes.length === 0 ||
    !settings.contentTypes.every(isContentType) ||
    !isExternalPlayer(settings.externalPlayer) ||
    settings.virusWarningAccepted !== true ||
    settings.ispWarningAccepted !== true
  ) {
    return false;
  }

  const needsDebrid = settings.contentTypes.some(contentTypeRequiresRealDebrid);
  if (needsDebrid && !hasRealDebridApiKey(settings)) {
    return false;
  }

  return true;
}

export function sanitizeSettings(settings: UserSettings & { streamMode?: unknown }): UserSettings {
  const contentTypes = Array.isArray(settings.contentTypes)
    ? settings.contentTypes.filter(isContentType)
    : undefined;

  return {
    realDebridApiKey: settings.realDebridApiKey || undefined,
    externalPlayer: isExternalPlayer(settings.externalPlayer) ? settings.externalPlayer : undefined,
    deviceType: isDeviceType(settings.deviceType) ? settings.deviceType : undefined,
    contentTypes: contentTypes && contentTypes.length > 0 ? contentTypes : undefined,
    letterboxdUsername: settings.letterboxdUsername?.trim() || undefined,
    virusWarningAccepted:
      typeof settings.virusWarningAccepted === "boolean"
        ? settings.virusWarningAccepted
        : undefined,
    ispWarningAccepted:
      typeof settings.ispWarningAccepted === "boolean" ? settings.ispWarningAccepted : undefined,
    onboardingCompleted:
      typeof settings.onboardingCompleted === "boolean" ? settings.onboardingCompleted : undefined,
    updatedAt: typeof settings.updatedAt === "number" ? settings.updatedAt : undefined,
  };
}

function isDeviceType(value: unknown): value is DeviceType {
  return value === "desktop" || value === "mobile" || value === "tv";
}

function isContentType(value: unknown): value is ContentType {
  return (
    value === "movies_shows" ||
    value === "audiobooks" ||
    value === "music" ||
    value === "video_games"
  );
}

function isExternalPlayer(value: unknown): value is ExternalPlayer {
  return value === "disabled" || value === "vlc" || value === "outplayer";
}

function clearOptionalField<K extends keyof UserSettings>(
  next: UserSettings,
  partial: Partial<UserSettings>,
  key: K,
) {
  if (Object.prototype.hasOwnProperty.call(partial, key) && partial[key] === undefined) {
    delete next[key];
  }
}

function readStoredSettings(): UserSettings {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as UserSettings & { streamMode?: unknown };
    return sanitizeSettings(parsed);
  } catch {
    return {};
  }
}

function writeStoredSettings(settings: UserSettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
}

function notifySettingsChanged() {
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}
