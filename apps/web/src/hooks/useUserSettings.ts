import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  clearUserSettings,
  getUserSettings,
  isOnboardingComplete,
  replaceUserSettings,
  saveUserSettings,
  subscribeUserSettings,
  type UserSettings,
} from "@/lib/userSettings";

const LOCAL_ONLY_KEYS = [
  "deviceType",
  "contentTypes",
  "letterboxdUsername",
  "virusWarningAccepted",
  "ispWarningAccepted",
  "onboardingCompleted",
] as const satisfies ReadonlyArray<keyof UserSettings>;

export function useUserSettings() {
  const remoteSettings = useQuery(api.userSettings.getForUser);
  const upsertRemote = useMutation(api.userSettings.upsert);
  const clearRemote = useMutation(api.userSettings.clear);
  const [settings, setSettings] = useState<UserSettings>(() => getUserSettings());
  const lastSyncedRemoteAtRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribeUserSettings(setSettings);
  }, []);

  useEffect(() => {
    if (remoteSettings === undefined || remoteSettings === null) {
      return;
    }
    if (lastSyncedRemoteAtRef.current === remoteSettings.updatedAt) {
      return;
    }

    const localUpdatedAt = settings.updatedAt ?? 0;
    const remoteUpdatedAt = remoteSettings.updatedAt ?? 0;
    if (remoteUpdatedAt > localUpdatedAt) {
      lastSyncedRemoteAtRef.current = remoteUpdatedAt;
      const localOnly = pickLocalOnlyFields(settings);
      setSettings(
        replaceUserSettings({
          ...localOnly,
          realDebridApiKey: remoteSettings.realDebridApiKey,
          externalPlayer: remoteSettings.externalPlayer,
          updatedAt: remoteUpdatedAt,
        }),
      );
      return;
    }

    if (localUpdatedAt > remoteUpdatedAt) {
      lastSyncedRemoteAtRef.current = localUpdatedAt;
      void upsertRemote(remotePayload(settings)).catch(() => {
        lastSyncedRemoteAtRef.current = null;
      });
    }
  }, [remoteSettings, settings, upsertRemote]);

  const saveSettings = useCallback(
    (partial: Partial<UserSettings>) => {
      const next = saveUserSettings(partial);
      setSettings(next);
      void upsertRemote(remotePayload(next, partial)).catch(() => undefined);
      return next;
    },
    [upsertRemote],
  );

  const resetSettings = useCallback(() => {
    clearUserSettings();
    setSettings({});
    void clearRemote().catch(() => undefined);
  }, [clearRemote]);

  return {
    settings,
    realDebridApiKey: settings.realDebridApiKey ?? "",
    externalPlayer: settings.externalPlayer ?? "disabled",
    deviceType: settings.deviceType,
    contentTypes: settings.contentTypes ?? [],
    letterboxdUsername: settings.letterboxdUsername ?? "",
    virusWarningAccepted: settings.virusWarningAccepted === true,
    ispWarningAccepted: settings.ispWarningAccepted === true,
    onboardingCompleted: isOnboardingComplete(settings),
    saveSettings,
    resetSettings,
    syncEnabled: remoteSettings !== null && remoteSettings !== undefined,
  };
}

function pickLocalOnlyFields(settings: UserSettings): Partial<UserSettings> {
  const result: Partial<UserSettings> = {};
  for (const key of LOCAL_ONLY_KEYS) {
    if (settings[key] !== undefined) {
      (result as Record<string, unknown>)[key] = settings[key];
    }
  }
  return result;
}

function remotePayload(settings: UserSettings, partial?: Partial<UserSettings>) {
  const payload: {
    realDebridApiKey?: string | null;
    externalPlayer?: "disabled" | "vlc" | "outplayer";
    updatedAt?: number;
  } = {
    updatedAt: settings.updatedAt,
  };
  if (settings.realDebridApiKey !== undefined) {
    payload.realDebridApiKey = settings.realDebridApiKey;
  } else if (
    partial &&
    Object.prototype.hasOwnProperty.call(partial, "realDebridApiKey") &&
    partial.realDebridApiKey === undefined
  ) {
    payload.realDebridApiKey = null;
  }
  if (settings.externalPlayer !== undefined) {
    payload.externalPlayer = settings.externalPlayer;
  }
  return payload;
}
