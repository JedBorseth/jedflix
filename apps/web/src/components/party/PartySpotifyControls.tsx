import { CheckCircledIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { PartyState } from "@/components/party/partyContext";
import { useSpotifyLink } from "@/components/party/useSpotifyLink";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Device = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
};

/**
 * Spotify controls inside the party panel. Each member links and steers their
 * own account; other members' accounts are shown read-only because their
 * tokens are only ever used server-side.
 */
export function PartySpotifyControls({
  party,
  clientId,
}: {
  party: PartyState;
  clientId: string;
}) {
  const { account, configured, connecting, error: linkError, connect } = useSpotifyLink();
  const listDevices = useAction(api.spotify.listMyDevices);
  const setTarget = useMutation(api.party.setSpotifyTarget);

  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const myTarget = party.spotifyTargets.find((target) => target.isSelf) ?? null;
  const otherTargets = party.spotifyTargets.filter((target) => !target.isSelf);

  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true);
    const result = await listDevices();
    setDevices(result.devices);
    setDevicesError(result.error);
    setLoadingDevices(false);
  }, [listDevices]);

  useEffect(() => {
    if (account) {
      void refreshDevices();
    }
  }, [account, refreshDevices]);

  const updateTarget = useCallback(
    async (next: { enabled: boolean; deviceId?: string | null; deviceName?: string | null }) => {
      setActionError(null);
      try {
        await setTarget({ clientId, ...next });
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "Could not update Spotify");
      }
    },
    [clientId, setTarget],
  );

  if (!configured) {
    return (
      <p className="text-sm text-zinc-500">
        Spotify is not configured on this server. Set SPOTIFY_CLIENT_ID and
        SPOTIFY_CLIENT_SECRET in the Convex deployment to enable Spotify sync.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {account ? (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{account.displayName}</p>
              <p className="text-xs text-zinc-500">Your Spotify account</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={myTarget?.enabled ? "secondary" : "default"}
              onClick={() =>
                void updateTarget({
                  enabled: !myTarget?.enabled,
                  deviceId: myTarget?.deviceId ?? null,
                  deviceName: myTarget?.deviceName ?? null,
                })
              }
            >
              {myTarget?.enabled ? "Mirroring" : "Mirror party"}
            </Button>
          </div>

          {account.isPremium ? null : (
            <p className="text-xs text-amber-400">
              This account is not Premium. Spotify only allows playback control on Premium
              accounts, so pushing tracks to it will fail.
            </p>
          )}

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs text-zinc-400" htmlFor="spotify-device">
                Device to control
              </label>
              <Select
                value={myTarget?.deviceId ?? "auto"}
                onValueChange={(value) => {
                  const device = devices.find((item) => item.id === value);
                  void updateTarget({
                    enabled: myTarget?.enabled ?? true,
                    deviceId: value === "auto" ? null : value,
                    deviceName: device?.name ?? null,
                  });
                }}
              >
                <SelectTrigger id="spotify-device">
                  <SelectValue placeholder="Active device" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Whatever is active</SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} · {device.type}
                      {device.isActive ? " (active)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => void refreshDevices()}
              disabled={loadingDevices}
              aria-label="Refresh Spotify devices"
            >
              <ReloadIcon className={loadingDevices ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>

          {devicesError ? <p className="text-xs text-amber-400">{devicesError}</p> : null}
          {myTarget?.lastError ? (
            <p className="text-xs text-red-400">{myTarget.lastError}</p>
          ) : null}
          {actionError ? <p className="text-xs text-red-400">{actionError}</p> : null}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-sm text-zinc-300">
            Connect Spotify to mirror this party onto a Spotify client. Tracks you play here
            switch there, and skipping there switches everyone here.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={connecting}
            onClick={() => void connect()}
          >
            {connecting ? "Opening Spotify…" : "Connect Spotify"}
          </Button>
          {linkError ? <p className="text-xs text-red-400">{linkError}</p> : null}
        </div>
      )}

      {otherTargets.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Also mirroring
          </p>
          {otherTargets.map((target) => (
            <div
              key={target._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{target.accountName}</p>
                <p className="truncate text-xs text-zinc-500">
                  {target.userName}
                  {target.deviceName ? ` · ${target.deviceName}` : ""}
                </p>
                {target.lastError ? (
                  <p className="truncate text-xs text-red-400">{target.lastError}</p>
                ) : null}
              </div>
              {target.enabled ? (
                <CheckCircledIcon className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <span className="shrink-0 text-xs text-zinc-500">Paused</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
