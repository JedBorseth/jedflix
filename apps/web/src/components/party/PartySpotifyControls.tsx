import { CheckCircledIcon } from "@radix-ui/react-icons";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import type { PartyState } from "@/components/party/partyContext";
import { useSpotifyLink } from "@/components/party/useSpotifyLink";
import { Button } from "@/components/ui/button";

/**
 * Spotify follow controls inside the party panel. Linked accounts stay the
 * source of track/seek; JedFlix mirrors what they play and can pause/resume
 * them. Other members' follows are shown read-only.
 */
export function PartySpotifyControls({
  party,
  clientId,
}: {
  party: PartyState;
  clientId: string;
}) {
  const { account, configured, connecting, error: linkError, connect } = useSpotifyLink();
  const setTarget = useMutation(api.party.setSpotifyTarget);

  const [actionError, setActionError] = useState<string | null>(null);

  const myTarget = party.spotifyTargets.find((target) => target.isSelf) ?? null;
  const otherTargets = party.spotifyTargets.filter((target) => !target.isSelf);

  const updateTarget = useCallback(
    async (enabled: boolean) => {
      setActionError(null);
      try {
        await setTarget({ clientId, enabled });
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
              <p className="text-xs text-zinc-500">
                Follow this account — tracks come from Spotify; pause/play syncs both ways
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={myTarget?.enabled ? "secondary" : "default"}
              onClick={() => void updateTarget(!myTarget?.enabled)}
            >
              {myTarget?.enabled ? "Following" : "Follow Spotify"}
            </Button>
          </div>

          {myTarget?.enabled ? (
            <p className="text-xs text-zinc-500">
              Spotify picks the song and seek position. Pausing or playing on JedFlix
              pauses or resumes Spotify (Premium required), and the reverse works too.
            </p>
          ) : null}

          {myTarget?.lastError ? (
            <p className="text-xs text-red-400">{myTarget.lastError}</p>
          ) : null}
          {actionError ? <p className="text-xs text-red-400">{actionError}</p> : null}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-sm text-zinc-300">
            Connect Spotify so the party can follow its track and position. JedFlix can
            pause and resume Spotify, but will not change which song is playing.
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
            Also following
          </p>
          {otherTargets.map((target) => (
            <div
              key={target._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{target.accountName}</p>
                <p className="truncate text-xs text-zinc-500">{target.userName}</p>
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
