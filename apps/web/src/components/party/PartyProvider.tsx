import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { PartyContext, type PartyContextValue } from "@/components/party/partyContext";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { getDeviceLabel, getPartyClientId } from "@/lib/partyClient";
import { queueSignature, resolvePartySync, type PartySnapshot } from "@/lib/partySync";

const HEARTBEAT_INTERVAL_MS = 20_000;

function toPartyTrack(track: MusicQueueTrack) {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName,
    albumId: track.albumId,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
  };
}

export function PartyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const clientId = useMemo(() => getPartyClientId(), []);
  const player = useMusicPlayer();
  const partyResult = useQuery(api.party.getState, isAuthenticated ? { clientId } : "skip");
  const party = partyResult ?? null;

  const [panelOpen, setPanelOpen] = useState(false);

  const create = useMutation(api.party.create);
  const join = useMutation(api.party.join);
  const leave = useMutation(api.party.leave);
  const heartbeat = useMutation(api.party.heartbeat);
  const setTrack = useMutation(api.party.setTrack);
  const setPlaying = useMutation(api.party.setPlaying);

  // The player context changes identity on every timeupdate, so read it through
  // a ref and keep the sync effect keyed to the fields that actually matter.
  const playerRef = useRef(player);
  playerRef.current = player;

  const baselineRef = useRef<{ local: PartySnapshot | null; remote: PartySnapshot | null }>({
    local: null,
    remote: null,
  });
  const queueSignatureRef = useRef<string | null>(null);

  const inParty = party !== null;

  useEffect(() => {
    if (!inParty) {
      return;
    }
    const tick = () => void heartbeat({ clientId }).catch(() => undefined);
    tick();
    const timer = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [clientId, heartbeat, inParty]);

  const localTrackId = player.current?.id ?? null;
  // `loading` counts as playing so the gap between picking a track and the
  // audio actually starting is not mistaken for a pause.
  const localPlaying = player.playing || player.loading;

  useEffect(() => {
    if (!party) {
      baselineRef.current = { local: null, remote: null };
      queueSignatureRef.current = null;
      return;
    }

    const activePlayer = playerRef.current;
    const local: PartySnapshot = { trackId: localTrackId, playing: localPlaying };
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
    baselineRef.current = { local: decision.nextLocal, remote: decision.nextRemote };

    if (decision.action === "apply") {
      if (remote.trackId !== local.trackId) {
        if (party.track) {
          const queue = party.queue.length > 0 ? party.queue : [party.track];
          activePlayer.playTrack(party.track, queue);
          queueSignatureRef.current = queueSignature(queue.map((track) => track.id));
          // playTrack always starts audio, so record that as the expected local
          // state. If the party is paused the next pass will pause us.
          baselineRef.current.local = { trackId: party.track.id, playing: true };
        } else {
          activePlayer.pause();
        }
      } else if (remote.playing) {
        activePlayer.play();
      } else {
        activePlayer.pause();
      }
      return;
    }

    if (decision.action === "push") {
      if (local.trackId !== remote.trackId && activePlayer.current) {
        const signature = queueSignature(activePlayer.queue.map((track) => track.id));
        const queueChanged = signature !== queueSignatureRef.current;
        queueSignatureRef.current = signature;
        void setTrack({
          clientId,
          track: toPartyTrack(activePlayer.current),
          queueIndex: activePlayer.queueIndex,
          queue: queueChanged ? activePlayer.queue.map(toPartyTrack) : undefined,
        }).catch(() => undefined);
      } else {
        void setPlaying({ clientId, isPlaying: local.playing }).catch(() => undefined);
      }
    }
  }, [clientId, localPlaying, localTrackId, party, setPlaying, setTrack]);

  const resetSyncBaseline = useCallback(() => {
    baselineRef.current = { local: null, remote: null };
    queueSignatureRef.current = null;
  }, []);

  const createParty = useCallback(async () => {
    resetSyncBaseline();
    const result = await create({ clientId, deviceLabel: getDeviceLabel() });
    return result.code;
  }, [clientId, create, resetSyncBaseline]);

  const joinParty = useCallback(
    async (code: string) => {
      resetSyncBaseline();
      const result = await join({ code, clientId, deviceLabel: getDeviceLabel() });
      return result.code;
    },
    [clientId, join, resetSyncBaseline],
  );

  const leaveParty = useCallback(async () => {
    await leave({ clientId });
    resetSyncBaseline();
  }, [clientId, leave, resetSyncBaseline]);

  const value = useMemo<PartyContextValue>(
    () => ({
      clientId,
      party,
      loading: isAuthenticated && partyResult === undefined,
      panelOpen,
      setPanelOpen,
      createParty,
      joinParty,
      leaveParty,
    }),
    [
      clientId,
      createParty,
      isAuthenticated,
      joinParty,
      leaveParty,
      panelOpen,
      party,
      partyResult,
    ],
  );

  return <PartyContext.Provider value={value}>{children}</PartyContext.Provider>;
}
