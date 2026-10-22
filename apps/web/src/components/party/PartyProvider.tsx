import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import {
  PartyContext,
  type PartyContextValue,
} from "@/components/party/partyContext";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { withCachedArtwork } from "@/lib/musicQueueArtwork";
import {
  clearGuestPartyToken,
  getGuestPartyToken,
  getDeviceLabel,
  getPartyClientId,
} from "@/lib/partyClient";
import {
  estimatedPositionMs,
  POSITION_SYNC_GRACE_MS,
  queueSignature,
  resolvePartySync,
  shouldSyncPosition,
  type PartySnapshot,
} from "@/lib/partySync";

const HEARTBEAT_INTERVAL_MS = 20_000;
/** Match Convex partyModel.MAX_PARTY_QUEUE — never upload a 1000+ local queue. */
const MAX_PARTY_QUEUE = 100;

function toPartyTrack(track: MusicQueueTrack) {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName,
    albumId: track.albumId,
    imageUrl: withCachedArtwork(track).imageUrl,
    durationMs: track.durationMs,
  };
}

export function PartyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const navigate = useNavigate();
  const [guestToken, setGuestToken] = useState(() => getGuestPartyToken());
  const [joining, setJoining] = useState(false);
  const isGuest = !isAuthenticated && guestToken !== null;
  const clientId = useMemo(() => getPartyClientId(), []);
  const player = useMusicPlayer();
  const partyResult = useQuery(
    api.party.getState,
    isAuthenticated ? { clientId } : "skip",
  );
  const guestResult = useQuery(
    api.party.getGuestState,
    !authLoading && isGuest ? { guestToken } : "skip",
  );
  const activeResult = isAuthenticated ? partyResult : guestResult;
  const party = activeResult ?? null;
  const credentials = useMemo(
    () => ({ clientId, ...(isGuest ? { guestToken } : {}) }),
    [clientId, guestToken, isGuest],
  );
  const previousPartyRef = useRef<typeof party>(null);
  useEffect(() => {
    if (activeResult === undefined || joining) return;
    if (previousPartyRef.current && !party) {
      playerRef.current.clear();
      toast.info("The party has ended.");
      setPanelOpen(false);
      if (isGuest) void navigate("/party", { replace: true });
    }
    if (isGuest && !party) {
      clearGuestPartyToken();
      setGuestToken(null);
    }
    previousPartyRef.current = party;
  }, [activeResult, isGuest, joining, navigate, party]);

  const [panelOpen, setPanelOpen] = useState(false);

  const create = useMutation(api.party.create);
  const join = useMutation(api.party.join);
  const leave = useMutation(api.party.leave);
  const heartbeat = useMutation(api.party.heartbeat);
  const joinGuest = useMutation(api.party.joinGuest);
  const leaveGuest = useMutation(api.party.leaveGuest);
  const heartbeatGuest = useMutation(api.party.heartbeatGuest);
  const setTrack = useMutation(api.party.setTrack);
  const setPlaying = useMutation(api.party.setPlaying);
  const setPosition = useMutation(api.party.setPosition);
  const setQueue = useMutation(api.party.setQueue);

  // The player context changes identity on every timeupdate, so read it through
  // a ref and keep the sync effect keyed to the fields that actually matter.
  const playerRef = useRef(player);
  playerRef.current = player;

  const baselineRef = useRef<{
    local: PartySnapshot | null;
    remote: PartySnapshot | null;
  }>({
    local: null,
    remote: null,
  });
  const queueSignatureRef = useRef<string | null>(null);
  const queuesRef = useRef<{ local: string; remote: string } | null>(null);
  /** Skip reporting the next local currentTime jump — we caused it via apply. */
  const suppressSeekReportRef = useRef(false);
  /** Re-apply a remote seek once audio finishes loading (currentTime often resets). */
  const pendingSeekSecRef = useRef<number | null>(null);
  /** Last party position clock we already sought to, so we do not re-seek every tick. */
  const lastAppliedPositionAtRef = useRef<number | null>(null);
  /** Track id whose stream failed — do not retry play() or broadcast a pause for it. */
  const failedTrackIdRef = useRef<string | null>(null);
  const localTimeProbeRef = useRef<{ timeSec: number; wallMs: number }>({
    timeSec: 0,
    wallMs: Date.now(),
  });

  const inParty = party !== null;

  useEffect(() => {
    if (!inParty) {
      return;
    }
    const tick = () =>
      void (
        isGuest ? heartbeatGuest({ guestToken }) : heartbeat({ clientId })
      ).catch(() => undefined);
    tick();
    const timer = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [clientId, guestToken, heartbeat, heartbeatGuest, inParty, isGuest]);

  const localTrackId = player.current?.id ?? null;
  const playerError = player.error;
  // Count `loading` as playing only while the party itself is still playing.
  // That covers the silent gap after picking a track without letting a Spotify
  // pause get overwritten by a still-resolving audio load.
  const localPlaying =
    player.playing || (player.loading && (party?.isPlaying ?? true));
  const localCurrentTime = player.currentTime;
  const localLoading = player.loading;

  useEffect(() => {
    if (playerError && localTrackId) {
      failedTrackIdRef.current = localTrackId;
    } else if (!playerError && player.playing) {
      failedTrackIdRef.current = null;
    }
  }, [localTrackId, player.playing, playerError]);

  const applyPartyPosition = useCallback(
    (positionMs: number, opts?: { immediate?: boolean }) => {
      const targetSec = Math.max(0, positionMs / 1000);
      suppressSeekReportRef.current = true;
      pendingSeekSecRef.current = targetSec;
      // Seeking before the element has a playable source throws / marks it broken.
      if (opts?.immediate !== false && !playerRef.current.loading) {
        playerRef.current.seek(targetSec);
        localTimeProbeRef.current = { timeSec: targetSec, wallMs: Date.now() };
      }
    },
    [],
  );

  useEffect(() => {
    if (!party) {
      baselineRef.current = { local: null, remote: null };
      queueSignatureRef.current = null;
      lastAppliedPositionAtRef.current = null;
      pendingSeekSecRef.current = null;
      failedTrackIdRef.current = null;
      return;
    }

    const activePlayer = playerRef.current;
    const failedTrack =
      failedTrackIdRef.current === localTrackId && localTrackId !== null;
    // Treat a failed stream as still "on" the party track for sync decisions so we
    // neither push a fake pause nor keep re-applying play() on a dead source.
    const local: PartySnapshot = {
      trackId: localTrackId,
      playing: failedTrack ? party.isPlaying : localPlaying,
    };
    const remote: PartySnapshot = {
      trackId: party.track?.id ?? null,
      playing: party.isPlaying,
    };
    const decision = resolvePartySync({
      local,
      remote,
      lastLocal: baselineRef.current.local,
      lastRemote: baselineRef.current.remote,
    });
    baselineRef.current = {
      local: decision.nextLocal,
      remote: decision.nextRemote,
    };

    if (decision.action === "apply") {
      if (remote.trackId !== local.trackId) {
        if (party.track) {
          // Keep the party track playable even when it is not already in the
          // mirrored queue (common when someone picks a song on Spotify).
          const queue = party.queue.some(
            (track) => track.id === party.track!.id,
          )
            ? party.queue
            : [party.track, ...party.queue];
          failedTrackIdRef.current = null;
          activePlayer.playTrack(party.track, queue);
          queueSignatureRef.current = queueSignature(
            queue.map((track) => track.id),
          );
          if (!remote.playing) activePlayer.pause();
          baselineRef.current.local = {
            trackId: party.track.id,
            playing: remote.playing,
          };
          const positionMs = estimatedPositionMs({
            positionMs: party.positionMs,
            positionUpdatedAt: party.positionUpdatedAt,
            isPlaying: party.isPlaying,
            now: Date.now(),
            durationMs: party.track.durationMs,
          });
          lastAppliedPositionAtRef.current = party.positionUpdatedAt;
          if (positionMs > 1_000) {
            // Defer seek until the new source can play — immediate seek on a
            // loading/failed element contributes to "operation is not supported".
            applyPartyPosition(positionMs, { immediate: false });
          }
        } else {
          activePlayer.pause();
        }
      } else if (remote.playing) {
        if (failedTrackIdRef.current === remote.trackId) {
          // Stream already failed for this track; wait for Spotify/party to move on.
          return;
        }
        activePlayer.play();
      } else {
        activePlayer.pause();
      }
      return;
    }

    if (decision.action === "push") {
      if (local.trackId !== remote.trackId && activePlayer.current) {
        const upcoming = activePlayer.queue.slice(
          activePlayer.queueIndex,
          activePlayer.queueIndex + MAX_PARTY_QUEUE,
        );
        const signature = queueSignature(upcoming.map((track) => track.id));
        const queueChanged = signature !== queueSignatureRef.current;
        queueSignatureRef.current = signature;
        void setTrack({
          ...credentials,
          track: toPartyTrack(activePlayer.current),
          queueIndex: 0,
          queue: queueChanged ? upcoming.map(toPartyTrack) : undefined,
        }).catch(() => undefined);
      } else if (failedTrack) {
        // Our YouTube stream failed — do not pause the whole party / Spotify.
        return;
      } else {
        void setPlaying({ ...credentials, isPlaying: local.playing }).catch(
          () => undefined,
        );
      }
    }
  }, [
    applyPartyPosition,
    credentials,
    localPlaying,
    localTrackId,
    party,
    playerError,
    setPlaying,
    setTrack,
  ]);

  // Queue edits sync separately so adding/reordering songs never restarts audio.
  const localQueueSignature = queueSignature(
    player.queue
      .slice(player.queueIndex, player.queueIndex + MAX_PARTY_QUEUE)
      .map((track) => track.id),
  );
  const remoteQueueSignature = party
    ? queueSignature(party.queue.map((track) => track.id))
    : "";
  useEffect(() => {
    if (!party) {
      queuesRef.current = null;
      return;
    }
    if (!party.track || localTrackId !== party.track.id) {
      queuesRef.current = null;
      return;
    }
    const previous = queuesRef.current;
    const remoteChanged = !previous || previous.remote !== remoteQueueSignature;
    const localChanged = previous && previous.local !== localQueueSignature;
    if (localQueueSignature === remoteQueueSignature) {
      queuesRef.current = {
        local: localQueueSignature,
        remote: remoteQueueSignature,
      };
    } else if (
      remoteChanged &&
      party.queue.some((track) => track.id === localTrackId)
    ) {
      playerRef.current.syncPartyQueue(party.queue);
      queuesRef.current = {
        local: remoteQueueSignature,
        remote: remoteQueueSignature,
      };
    } else if (localChanged) {
      const active = playerRef.current;
      const tracks = active.queue
        .slice(active.queueIndex, active.queueIndex + MAX_PARTY_QUEUE)
        .map(toPartyTrack);
      queuesRef.current = {
        local: localQueueSignature,
        remote: remoteQueueSignature,
      };
      void setQueue({ ...credentials, tracks }).catch(() => undefined);
    } else if (!previous) {
      queuesRef.current = {
        local: localQueueSignature,
        remote: remoteQueueSignature,
      };
    }
  }, [
    credentials,
    localQueueSignature,
    localTrackId,
    party,
    remoteQueueSignature,
    setQueue,
  ]);

  // Seek to a remote position when the party clock moved and we drifted > 5s.
  useEffect(() => {
    if (!party?.track || localTrackId !== party.track.id) {
      return;
    }
    if (failedTrackIdRef.current === party.track.id) {
      return;
    }
    if (lastAppliedPositionAtRef.current === party.positionUpdatedAt) {
      return;
    }

    const now = Date.now();
    const remoteMs = estimatedPositionMs({
      positionMs: party.positionMs,
      positionUpdatedAt: party.positionUpdatedAt,
      isPlaying: party.isPlaying,
      now,
      durationMs: party.track.durationMs,
    });
    const localMs = Math.round(localCurrentTime * 1000);
    if (!shouldSyncPosition(localMs, remoteMs)) {
      lastAppliedPositionAtRef.current = party.positionUpdatedAt;
      return;
    }

    lastAppliedPositionAtRef.current = party.positionUpdatedAt;
    applyPartyPosition(remoteMs, { immediate: !localLoading });
  }, [
    applyPartyPosition,
    localCurrentTime,
    localLoading,
    localTrackId,
    party?.isPlaying,
    party?.positionMs,
    party?.positionUpdatedAt,
    party?.track,
  ]);

  // After a track load, re-apply any pending seek (HTMLAudio often resets to 0).
  useEffect(() => {
    if (localLoading || pendingSeekSecRef.current === null) {
      return;
    }
    if (failedTrackIdRef.current && failedTrackIdRef.current === localTrackId) {
      pendingSeekSecRef.current = null;
      return;
    }
    const targetSec = pendingSeekSecRef.current;
    pendingSeekSecRef.current = null;
    suppressSeekReportRef.current = true;
    playerRef.current.seek(targetSec);
    localTimeProbeRef.current = { timeSec: targetSec, wallMs: Date.now() };
  }, [localLoading, localTrackId]);

  // Detect local seeks (scrub / skip) and publish them when drift exceeds grace.
  useEffect(() => {
    if (!party?.track || localTrackId !== party.track.id) {
      localTimeProbeRef.current = {
        timeSec: localCurrentTime,
        wallMs: Date.now(),
      };
      return;
    }

    const now = Date.now();
    const prev = localTimeProbeRef.current;
    const wallDelta = now - prev.wallMs;
    const mediaDeltaMs = (localCurrentTime - prev.timeSec) * 1000;
    localTimeProbeRef.current = { timeSec: localCurrentTime, wallMs: now };

    if (suppressSeekReportRef.current) {
      suppressSeekReportRef.current = false;
      return;
    }

    const expectedDelta = localPlaying ? wallDelta : 0;
    if (Math.abs(mediaDeltaMs - expectedDelta) <= POSITION_SYNC_GRACE_MS) {
      return;
    }

    const positionMs = Math.round(localCurrentTime * 1000);
    const remoteMs = estimatedPositionMs({
      positionMs: party.positionMs,
      positionUpdatedAt: party.positionUpdatedAt,
      isPlaying: party.isPlaying,
      now,
      durationMs: party.track.durationMs,
    });
    if (!shouldSyncPosition(positionMs, remoteMs)) {
      return;
    }

    lastAppliedPositionAtRef.current = null;
    void setPosition({ ...credentials, positionMs }).catch(() => undefined);
  }, [
    credentials,
    localCurrentTime,
    localPlaying,
    localTrackId,
    party?.isPlaying,
    party?.positionMs,
    party?.positionUpdatedAt,
    party?.track,
    setPosition,
  ]);

  const resetSyncBaseline = useCallback(() => {
    baselineRef.current = { local: null, remote: null };
    queuesRef.current = null;
    queueSignatureRef.current = null;
    lastAppliedPositionAtRef.current = null;
    pendingSeekSecRef.current = null;
    suppressSeekReportRef.current = false;
    failedTrackIdRef.current = null;
  }, []);

  const createParty = useCallback(async () => {
    resetSyncBaseline();
    const result = await create({ clientId, deviceLabel: getDeviceLabel() });
    return result.code;
  }, [clientId, create, resetSyncBaseline]);

  const joinParty = useCallback(
    async (code: string) => {
      setJoining(true);
      try {
        resetSyncBaseline();
        if (isAuthenticated) {
          const result = await join({
            code,
            clientId,
            deviceLabel: getDeviceLabel(),
          });
          return result.code;
        }
        const token = getGuestPartyToken(true)!;
        const result = await joinGuest({
          code,
          guestToken: token,
          deviceLabel: getDeviceLabel(),
        });
        setGuestToken(token);
        return result.code;
      } finally {
        setJoining(false);
      }
    },
    [clientId, isAuthenticated, join, joinGuest, resetSyncBaseline],
  );

  const leaveParty = useCallback(async () => {
    if (isGuest) {
      await leaveGuest({ guestToken });
      clearGuestPartyToken();
      setGuestToken(null);
      void navigate("/party", { replace: true });
    } else {
      await leave({ clientId });
    }
    previousPartyRef.current = null;
    playerRef.current.clear();
    setPanelOpen(false);
    resetSyncBaseline();
  }, [
    clientId,
    guestToken,
    isGuest,
    leave,
    leaveGuest,
    navigate,
    resetSyncBaseline,
  ]);

  const value = useMemo<PartyContextValue>(
    () => ({
      clientId,
      party,
      loading:
        authLoading ||
        joining ||
        ((isAuthenticated || isGuest) && activeResult === undefined),
      isGuest,
      panelOpen,
      setPanelOpen,
      createParty,
      joinParty,
      leaveParty,
    }),
    [
      clientId,
      createParty,
      activeResult,
      authLoading,
      isAuthenticated,
      isGuest,
      joining,
      joinParty,
      leaveParty,
      panelOpen,
      party,
    ],
  );

  return (
    <PartyContext.Provider value={value}>{children}</PartyContext.Provider>
  );
}
