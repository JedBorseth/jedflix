import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  clearUserSettings,
  getUserSettings,
  replaceUserSettings,
  saveUserSettings,
  subscribeUserSettings,
  type UserSettings,
} from "@/lib/userSettings";

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
      setSettings(
        replaceUserSettings({
          realDebridApiKey: remoteSettings.realDebridApiKey,
          streamMode: remoteSettings.streamMode,
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
    streamMode: settings.streamMode ?? "proxy",
    externalPlayer: settings.externalPlayer ?? "disabled",
    saveSettings,
    resetSettings,
    syncEnabled: remoteSettings !== null && remoteSettings !== undefined,
  };
}

function remotePayload(settings: UserSettings, partial?: Partial<UserSettings>) {
  const payload: {
    realDebridApiKey?: string | null;
    streamMode?: "direct" | "proxy";
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
  if (settings.streamMode !== undefined) {
    payload.streamMode = settings.streamMode;
  }
  if (settings.externalPlayer !== undefined) {
    payload.externalPlayer = settings.externalPlayer;
  }
  return payload;
}
