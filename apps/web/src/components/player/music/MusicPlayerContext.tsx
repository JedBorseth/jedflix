import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { useMediaSession } from "@/hooks/useMediaSession";
import { resolveStreamServerAudioError } from "@/components/player/shared/playbackErrors";
import { playMediaElement } from "@/lib/mediaSession";
import { remapIndexAfterReorder, reorderItems } from "@/lib/musicQueue";
import {
  planQueueSourceSync,
  stripQueueArtwork,
  withCachedArtwork,
} from "@/lib/musicQueueArtwork";
import { getYoutubeAudioUrl, type TrackItem } from "@/lib/spotify";
import { recordRecentlyPlayedMusic } from "@/lib/recentlyPlayedMusic";
import {
  generateInfiniteQueueTracks,
  INFINITE_QUEUE_THRESHOLD,
} from "@/lib/infiniteQueueRecommendations";
import {
  prefetchYoutubeAudioTracks,
  upcomingTracksForPrefetch,
} from "@/lib/youtubeAudioPrefetch";

export type MusicQueueTrack = {
  id: string;
  title: string;
  artists: string[];
  artistIds?: string[];
  albumName: string;
  albumId?: string;
  imageUrl: string;
  durationMs: number;
  /** When set, audio resolve uses this YouTube video instead of searching. */
  youtubeVideoId?: string;
  /** Appended by Infinite Queue — manual addToQueue inserts ahead of these. */
  autoQueued?: boolean;
};

type MusicPlayerContextValue = {
  current: MusicQueueTrack | null;
  queue: MusicQueueTrack[];
  queueIndex: number;
  playing: boolean;
  loading: boolean;
  expanded: boolean;
  queueOpen: boolean;
  infiniteQueue: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  /**
   * Start playback. Returns a generation token so playlist pages can append
   * later pages without clobbering a newer play session.
   */
  playTrack: (track: MusicQueueTrack, queue?: MusicQueueTrack[]) => number;
  playAlbumTracks: (
    tracks: TrackItem[],
    album: {
      id: string;
      name: string;
      imageUrl: string;
      artists: string[];
      artistIds?: string[];
    },
    startIndex?: number,
  ) => void;
  playQueueIndex: (index: number) => void;
  addToQueue: (track: MusicQueueTrack) => void;
  /**
   * When a playlist is still paginating, replace the queue with `next` only if
   * `generation` matches this session and the user has not manually edited the queue.
   */
  extendQueueFromSource: (next: MusicQueueTrack[], generation: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  /** Drop every track after the one currently playing. */
  clearUpcoming: () => void;
  setInfiniteQueue: (enabled: boolean) => void;
  toggle: () => void;
  pause: () => void;
  play: () => void;
  next: () => void;
  previous: () => void;
  seek: (timeSec: number) => void;
  setExpanded: (expanded: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  /** Stop playback and dismiss the player entirely. */
  clear: () => void;
};

// Survive Vite HMR — createContext() on every hot reload otherwise breaks Provider identity.
const MUSIC_PLAYER_CONTEXT_KEY = "__jedflixMusicPlayerContext__";
type MusicPlayerGlobal = typeof globalThis & {
  [MUSIC_PLAYER_CONTEXT_KEY]?: Context<MusicPlayerContextValue | null>;
};
const musicPlayerGlobal = globalThis as MusicPlayerGlobal;
const MusicPlayerContext =
  musicPlayerGlobal[MUSIC_PLAYER_CONTEXT_KEY] ??
  (musicPlayerGlobal[MUSIC_PLAYER_CONTEXT_KEY] =
    createContext<MusicPlayerContextValue | null>(null));

function artistLabel(artists: string[]): string {
  return artists.filter(Boolean).join(", ") || "Unknown artist";
}

function toQueueTrack(
  track: TrackItem,
  album: {
    id: string;
    name: string;
    imageUrl: string;
    artists: string[];
    artistIds?: string[];
  },
): MusicQueueTrack {
  const artists = track.artists.length > 0 ? track.artists : album.artists;
  const artistIds =
    track.artistIds && track.artistIds.length > 0 ? track.artistIds : album.artistIds;
  return {
    id: track.id || `${album.id}-${track.discNumber}-${track.trackNumber}-${track.name}`,
    title: track.name,
    artists,
    artistIds,
    albumName: album.name,
    albumId: album.id,
    imageUrl: album.imageUrl,
    durationMs: track.durationMs,
  };
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playIntentRef = useRef(false);
  const loadGenerationRef = useRef(0);
  /** Bumped on every playTrack / clear so stale playlist pagination cannot append. */
  const queueSessionRef = useRef(0);
  /** Once the user reorders/removes/adds, stop auto-syncing from the playlist source. */
  const queueDirtyRef = useRef(false);
  const prefetchedIdsRef = useRef<Set<string>>(new Set());
  /** Trusted catalog duration (seconds). Prefer over flaky stream metadata. */
  const catalogDurationSecRef = useRef(0);
  /** Prevents double-advance when catalog end and stream `ended` both fire. */
  const catalogEndedRef = useRef(false);
  const [queue, setQueue] = useState<MusicQueueTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [infiniteQueue, setInfiniteQueueState] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const queueIndexRef = useRef(0);
  queueIndexRef.current = queueIndex;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const infiniteQueueRef = useRef(false);
  infiniteQueueRef.current = infiniteQueue;
  /** Recently played tracks for Infinite Queue recommendation context. */
  const playHistoryRef = useRef<MusicQueueTrack[]>([]);
  const infiniteRefillInFlightRef = useRef(false);

  const current = useMemo(() => {
    const track = queue[queueIndex] ?? null;
    return track ? withCachedArtwork(track) : null;
  }, [queue, queueIndex]);

  const applyPlayResult = useCallback(
    (audio: HTMLAudioElement, generation: number, result: Awaited<ReturnType<typeof playMediaElement>>) => {
      if (generation !== loadGenerationRef.current) {
        return;
      }
      if (result.status === "error") {
        // Keep playIntent — iOS lock-screen / background resume often fails once
        // after a pause; callers reload the stream and retry instead of giving up.
        setError(result.error.message);
        setPlaying(false);
        setLoading(false);
        return;
      }
      if (result.status === "playing" && !audio.paused) {
        setPlaying(true);
        setLoading(false);
        setError(null);
        return;
      }
      // Aborted or still buffering — keep play intent; loadedmetadata/canplay may retry.
      // Never mark the UI as playing when the element is paused (iOS Media Session trap).
      if (audio.paused) {
        setPlaying(false);
      }
    },
    [],
  );

  const startPlayback = useCallback(
    (audio: HTMLAudioElement, generation: number) => {
      if (generation !== loadGenerationRef.current || !playIntentRef.current) {
        return;
      }
      void playMediaElement(audio).then((result) => {
        applyPlayResult(audio, generation, result);
      });
    },
    [applyPlayResult],
  );

  /**
   * Load a track and start playback.
   * `immediatePlay` must be true for Media Session / user-gesture skips so iOS
   * keeps the activation token — waiting only for loadedmetadata loses it and
   * leaves the UI "playing" with silent audio.
   */
  const loadAndPlay = useCallback(
    (track: MusicQueueTrack, options?: { immediatePlay?: boolean }) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      const playable = withCachedArtwork(track);
      const generation = ++loadGenerationRef.current;
      recordRecentlyPlayedMusic({
        id: playable.id,
        title: playable.title,
        artists: playable.artists,
        artistIds: playable.artistIds,
        albumName: playable.albumName,
        albumId: playable.albumId,
        imageUrl: playable.imageUrl,
        durationMs: playable.durationMs,
      });
      const history = playHistoryRef.current.filter((item) => item.id !== playable.id);
      history.push(playable);
      playHistoryRef.current = history.slice(-20);
      const videoId =
        playable.youtubeVideoId ||
        (playable.id.startsWith("yt:") ? playable.id.slice(3) : undefined);
      const src = getYoutubeAudioUrl({
        artist: artistLabel(playable.artists),
        title: playable.title,
        album: playable.albumName,
        durationMs: playable.durationMs > 0 ? playable.durationMs : undefined,
        videoId,
      });
      playIntentRef.current = true;
      setLoading(true);
      setError(null);
      setCurrentTime(0);
      const catalogSec = playable.durationMs > 0 ? playable.durationMs / 1000 : 0;
      catalogDurationSecRef.current = catalogSec;
      catalogEndedRef.current = false;
      setDuration(catalogSec);
      // Assigning src selects the resource. Avoid audio.load() here — it aborts a
      // play() started in the same Media Session turn on iOS and can leave the
      // element in MEDIA_ERR_SRC_NOT_SUPPORTED ("operation is not supported").
      audio.src = src;
      if (options?.immediatePlay) {
        startPlayback(audio, generation);
      }
    },
    [startPlayback],
  );

  const playTrack = useCallback(
    (track: MusicQueueTrack, nextQueue?: MusicQueueTrack[]) => {
      let list = nextQueue && nextQueue.length > 0 ? nextQueue : [track];
      let index = list.findIndex((item) => item.id === track.id);
      // A track outside the current queue (e.g. one picked on Spotify) must not
      // collapse to index 0 — that would play the wrong song and bounce it back.
      if (index < 0) {
        list = [track, ...list.filter((item) => item.id !== track.id)];
        index = 0;
      }
      const session = ++queueSessionRef.current;
      queueDirtyRef.current = false;
      prefetchedIdsRef.current = new Set([track.id]);
      playHistoryRef.current = [];
      setQueue(stripQueueArtwork(list, index));
      setQueueIndex(index);
      setQueueOpen(false);
      loadAndPlay(list[index] ?? track, { immediatePlay: true });
      return session;
    },
    [loadAndPlay],
  );

  const extendQueueFromSource = useCallback(
    (next: MusicQueueTrack[], generation: number) => {
      if (
        generation !== queueSessionRef.current ||
        queueDirtyRef.current ||
        next.length === 0
      ) {
        return;
      }
      const prev = queueRef.current;
      const currentId = prev[queueIndexRef.current]?.id ?? null;
      const planned = planQueueSourceSync({
        prev,
        next,
        currentId,
      });
      if (!planned) {
        return;
      }
      setQueue(stripQueueArtwork(planned.queue, planned.queueIndex));
      if (planned.queueIndex !== queueIndexRef.current) {
        setQueueIndex(planned.queueIndex);
      }
    },
    [],
  );

  const playAlbumTracks = useCallback(
    (
      tracks: TrackItem[],
      album: {
        id: string;
        name: string;
        imageUrl: string;
        artists: string[];
        artistIds?: string[];
      },
      startIndex = 0,
    ) => {
      const list = tracks.map((track) => toQueueTrack(track, album));
      if (list.length === 0) {
        return;
      }
      const index = Math.min(Math.max(startIndex, 0), list.length - 1);
      const startTrack = list[index];
      if (!startTrack) {
        return;
      }
      queueSessionRef.current += 1;
      queueDirtyRef.current = false;
      prefetchedIdsRef.current = new Set([startTrack.id]);
      playHistoryRef.current = [];
      setQueue(stripQueueArtwork(list, index));
      setQueueIndex(index);
      setQueueOpen(false);
      loadAndPlay(startTrack, { immediatePlay: true });
    },
    [loadAndPlay],
  );

  const playQueueIndex = useCallback(
    (index: number) => {
      const track = queue[index];
      if (!track) {
        return;
      }
      setQueueIndex(index);
      setQueue((prev) => stripQueueArtwork(prev, index));
      loadAndPlay(track, { immediatePlay: true });
    },
    [loadAndPlay, queue],
  );

  const addToQueue = useCallback(
    (track: MusicQueueTrack) => {
      if (queue.length === 0) {
        playTrack(track);
        return;
      }
      queueDirtyRef.current = true;
      const manualTrack = { ...track, autoQueued: false };
      setQueue((prev) => {
        // Manual adds jump ahead of Infinite Queue auto-fills.
        const insertAt = findManualInsertIndex(prev, queueIndexRef.current);
        const next = [...prev];
        next.splice(insertAt, 0, manualTrack);
        return next;
      });
    },
    [playTrack, queue.length],
  );

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    queueDirtyRef.current = true;
    setQueue((prev) => reorderItems(prev, fromIndex, toIndex));
    setQueueIndex((currentIndex) =>
      remapIndexAfterReorder(currentIndex, fromIndex, toIndex),
    );
  }, []);

  const removeFromQueue = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) {
        return;
      }
      queueDirtyRef.current = true;
      if (queue.length === 1) {
        playIntentRef.current = false;
        loadGenerationRef.current += 1;
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        setQueue([]);
        setQueueIndex(0);
        setPlaying(false);
        setLoading(false);
        setExpanded(false);
        setQueueOpen(false);
        setCurrentTime(0);
        setDuration(0);
        catalogDurationSecRef.current = 0;
        setError(null);
        return;
      }

      const removingCurrent = index === queueIndex;
      const nextQueue = queue.filter((_, i) => i !== index);
      const nextIndex =
        index < queueIndex ? queueIndex - 1 : Math.min(queueIndex, nextQueue.length - 1);
      setQueue(nextQueue);
      setQueueIndex(nextIndex);
      if (removingCurrent) {
        const track = nextQueue[nextIndex];
        if (track) {
          loadAndPlay(track, { immediatePlay: true });
        }
      }
    },
    [loadAndPlay, queue, queueIndex],
  );

  const clearUpcoming = useCallback(() => {
    queueDirtyRef.current = true;
    setQueue((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const currentTrack = prev[queueIndex];
      return currentTrack ? [currentTrack] : [];
    });
    setQueueIndex(0);
  }, [queueIndex]);

  const appendInfiniteRecommendations = useCallback(async () => {
    if (!infiniteQueueRef.current || infiniteRefillInFlightRef.current) {
      return;
    }
    const currentQueue = queueRef.current;
    const index = queueIndexRef.current;
    const remaining = currentQueue.length - index - 1;
    if (remaining >= INFINITE_QUEUE_THRESHOLD) {
      return;
    }
    const currentTrack = currentQueue[index] ?? null;
    if (!currentTrack) {
      return;
    }

    infiniteRefillInFlightRef.current = true;
    const session = queueSessionRef.current;
    try {
      const excludeIds = new Set(currentQueue.map((track) => track.id));
      const recent = playHistoryRef.current.slice(-8);
      const recentArtistNames = [...recent, ...currentQueue.slice(Math.max(0, index - 3), index + 1)]
        .map((track) => track.artists[0] ?? "")
        .filter(Boolean);

      const recommendations = await generateInfiniteQueueTracks({
        current: currentTrack,
        recent,
        excludeIds,
        recentArtistNames,
      });
      if (
        session !== queueSessionRef.current ||
        !infiniteQueueRef.current ||
        recommendations.length === 0
      ) {
        return;
      }
      setQueue((prev) => {
        const existing = new Set(prev.map((track) => track.id));
        const toAppend = recommendations
          .filter((track) => !existing.has(track.id))
          .map((track) => ({ ...track, autoQueued: true }));
        if (toAppend.length === 0) {
          return prev;
        }
        return [...prev, ...toAppend];
      });
    } catch {
      // Last.fm / network failures must never interrupt playback.
    } finally {
      infiniteRefillInFlightRef.current = false;
    }
  }, []);

  const setInfiniteQueue = useCallback(
    (enabled: boolean) => {
      setInfiniteQueueState(enabled);
      infiniteQueueRef.current = enabled;
      if (enabled) {
        // Kick a refill immediately so enabling IQ visibly grows the queue.
        void appendInfiniteRecommendations();
      }
    },
    [appendInfiniteRecommendations],
  );

  const pause = useCallback(() => {
    playIntentRef.current = false;
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) {
      return;
    }
    playIntentRef.current = true;
    setError(null);
    setLoading(true);
    // A previous MEDIA_ERR_SRC_NOT_SUPPORTED / background kill leaves the
    // element dead — calling play() again throws. Reload the stream.
    if (audio.error || !audio.src) {
      loadAndPlay(current, { immediatePlay: true });
      return;
    }
    const generation = loadGenerationRef.current;
    void playMediaElement(audio).then((result) => {
      if (generation !== loadGenerationRef.current || !playIntentRef.current) {
        return;
      }
      if (result.status === "error" || (result.status === "aborted" && audio.paused)) {
        // iOS often rejects the first play() after a lock-screen pause while the
        // tab was frozen — reload and retry with a fresh src in the same gesture.
        loadAndPlay(current, { immediatePlay: true });
        return;
      }
      applyPlayResult(audio, generation, result);
    });
  }, [applyPlayResult, current, loadAndPlay]);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
    } else {
      play();
    }
  }, [pause, play, playing]);

  // After returning from background / lock screen, resume if the user still wants audio.
  useEffect(() => {
    const resumeIfNeeded = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const audio = audioRef.current;
      if (!audio || !playIntentRef.current || !current) {
        return;
      }
      if (!audio.paused && !audio.error) {
        return;
      }
      if (audio.error || !audio.src) {
        loadAndPlay(current, { immediatePlay: true });
        return;
      }
      const generation = loadGenerationRef.current;
      void playMediaElement(audio).then((result) => {
        if (!playIntentRef.current) {
          return;
        }
        if (result.status === "error" || (result.status === "aborted" && audio.paused)) {
          loadAndPlay(current, { immediatePlay: true });
          return;
        }
        applyPlayResult(audio, generation, result);
      });
    };
    document.addEventListener("visibilitychange", resumeIfNeeded);
    window.addEventListener("pageshow", resumeIfNeeded);
    return () => {
      document.removeEventListener("visibilitychange", resumeIfNeeded);
      window.removeEventListener("pageshow", resumeIfNeeded);
    };
  }, [applyPlayResult, current, loadAndPlay]);

  const next = useCallback(() => {
    if (queueIndex >= queue.length - 1) {
      return;
    }
    const index = queueIndex + 1;
    const track = queue[index];
    if (!track) {
      return;
    }
    setQueueIndex(index);
    setQueue((prev) => stripQueueArtwork(prev, index));
    // immediatePlay keeps iOS Media Session / Control Center activation.
    loadAndPlay(track, { immediatePlay: true });
  }, [loadAndPlay, queue, queueIndex]);

  /** Advance on catalog end (Spotify length) or real stream EOF — YouTube often outlasts the song. */
  const handleTrackEnded = useCallback(() => {
    if (catalogEndedRef.current) {
      return;
    }
    catalogEndedRef.current = true;
    if (queueIndex < queue.length - 1) {
      next();
      return;
    }
    playIntentRef.current = false;
    setPlaying(false);
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
  }, [next, queue.length, queueIndex]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (queueIndex <= 0) {
      if (audio) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      return;
    }
    const index = queueIndex - 1;
    const track = queue[index];
    if (!track) {
      return;
    }
    setQueueIndex(index);
    setQueue((prev) => stripQueueArtwork(prev, index));
    loadAndPlay(track, { immediatePlay: true });
  }, [loadAndPlay, queue, queueIndex]);

  const seek = useCallback(
    (timeSec: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      // Prefer catalog duration — YouTube stream metadata is often inflated (~2×).
      const maxSec = duration > 0 ? duration : audio.duration || 0;
      const nextTime = Math.max(0, Math.min(maxSec, timeSec));
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [duration],
  );

  const clear = useCallback(() => {
    playIntentRef.current = false;
    loadGenerationRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    prefetchedIdsRef.current = new Set();
    catalogDurationSecRef.current = 0;
    catalogEndedRef.current = false;
    queueSessionRef.current += 1;
    queueDirtyRef.current = false;
    playHistoryRef.current = [];
    infiniteRefillInFlightRef.current = false;
    setQueue([]);
    setQueueIndex(0);
    setPlaying(false);
    setLoading(false);
    setExpanded(false);
    setQueueOpen(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  const handleSetExpanded = useCallback((nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    if (!nextExpanded) {
      setQueueOpen(false);
    }
  }, []);

  useEffect(() => {
    const upcoming = upcomingTracksForPrefetch(queue, queueIndex, 2);
    if (upcoming.length === 0) {
      return;
    }
    const controller = new AbortController();
    void prefetchYoutubeAudioTracks(upcoming, {
      signal: controller.signal,
      alreadyPrefetched: prefetchedIdsRef.current,
    });
    return () => controller.abort();
  }, [queue, queueIndex]);

  useEffect(() => {
    if (!infiniteQueue) {
      return;
    }
    const remaining = queue.length - queueIndex - 1;
    if (remaining >= INFINITE_QUEUE_THRESHOLD) {
      return;
    }
    void appendInfiniteRecommendations();
  }, [appendInfiniteRecommendations, infiniteQueue, queue, queueIndex]);

  useMediaSession({
    title: current?.title ?? "",
    artist: current ? artistLabel(current.artists) : undefined,
    album: current?.albumName,
    artworkUrl: current?.imageUrl,
    enabled: Boolean(current),
    playbackState: playing ? "playing" : current ? "paused" : "none",
    durationSec: duration > 0 ? duration : undefined,
    positionSec: currentTime,
    onPlay: play,
    onPause: pause,
    onPreviousTrack: previous,
    onNextTrack: next,
    onStop: pause,
    preferTrackSkip: true,
  });

  const value = useMemo<MusicPlayerContextValue>(
    () => ({
      current,
      queue,
      queueIndex,
      playing,
      loading,
      expanded,
      queueOpen,
      infiniteQueue,
      currentTime,
      duration,
      error,
      playTrack,
      playAlbumTracks,
      playQueueIndex,
      addToQueue,
      extendQueueFromSource,
      reorderQueue,
      removeFromQueue,
      clearUpcoming,
      setInfiniteQueue,
      toggle,
      pause,
      play,
      next,
      previous,
      seek,
      setExpanded: handleSetExpanded,
      setQueueOpen,
      clear,
    }),
    [
      addToQueue,
      clear,
      clearUpcoming,
      current,
      currentTime,
      duration,
      error,
      expanded,
      extendQueueFromSource,
      handleSetExpanded,
      infiniteQueue,
      loading,
      next,
      pause,
      play,
      playAlbumTracks,
      playQueueIndex,
      playTrack,
      playing,
      previous,
      queue,
      queueIndex,
      queueOpen,
      removeFromQueue,
      reorderQueue,
      seek,
      setInfiniteQueue,
      toggle,
    ],
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        className="hidden"
        preload="metadata"
        playsInline
        onPlay={() => {
          playIntentRef.current = true;
          setPlaying(true);
          setLoading(false);
          setError(null);
        }}
        onPause={() => {
          // Only clear playing when pause was intentional or the element truly
          // stopped — ignore transient pauses during src swaps if playIntent remains
          // and a newer load is about to call play().
          if (!playIntentRef.current) {
            setPlaying(false);
            return;
          }
          const audio = audioRef.current;
          if (audio && !audio.paused) {
            return;
          }
          // Src change fires pause before the next play() — keep UI optimistic
          // only briefly via loading state, not a false "playing" with no audio.
          setPlaying(false);
        }}
        onWaiting={() => setLoading(true)}
        onCanPlay={(event) => {
          setLoading(false);
          const audio = event.currentTarget;
          if (
            playIntentRef.current &&
            audio.paused &&
            !audio.error
          ) {
            startPlayback(audio, loadGenerationRef.current);
          }
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          const catalogSec = catalogDurationSecRef.current;
          if (catalogSec > 0) {
            setCurrentTime(Math.min(time, catalogSec));
            // YouTube streams often continue past the real song; advance at catalog end.
            if (time >= catalogSec - 0.25) {
              handleTrackEnded();
            }
            return;
          }
          setCurrentTime(time);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          const streamSec = audio.duration;
          const catalogSec = catalogDurationSecRef.current;
          if (Number.isFinite(streamSec) && streamSec > 0) {
            if (catalogSec <= 0) {
              setDuration(streamSec);
            } else {
              const ratio = streamSec / catalogSec;
              // Only trust stream duration when it agrees with Spotify metadata.
              // Proxied YouTube audio often reports inflated lengths (~2×).
              if (ratio > 0.85 && ratio < 1.15) {
                setDuration(streamSec);
              } else {
                setDuration(catalogSec);
              }
            }
          }
          setLoading(false);
          if (!playIntentRef.current || !audio.paused) {
            return;
          }
          startPlayback(audio, loadGenerationRef.current);
        }}
        onError={(event) => {
          // Don't clear playIntent — lock-screen Play after a background stream
          // kill must still be able to reload. Only intentional pause clears intent.
          setPlaying(false);
          setLoading(false);
          void resolveStreamServerAudioError(event.currentTarget).then((message) => {
            // Normalize the cryptic NotSupportedError that follows code 4.
            if (/operation is not supported/i.test(message)) {
              setError(
                "This stream format is not supported in your browser. Try another source. (media error code 4).",
              );
              return;
            }
            setError(message);
          });
        }}
        onEnded={() => {
          handleTrackEnded();
        }}
      />
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer(): MusicPlayerContextValue {
  const value = useContext(MusicPlayerContext);
  if (!value) {
    throw new Error("useMusicPlayer must be used within MusicPlayerProvider");
  }
  return value;
}

export function useOptionalMusicPlayer(): MusicPlayerContextValue | null {
  return useContext(MusicPlayerContext);
}

/** Insert manual tracks before the first upcoming auto-queued recommendation. */
function findManualInsertIndex(queue: MusicQueueTrack[], currentIndex: number): number {
  for (let i = currentIndex + 1; i < queue.length; i += 1) {
    if (queue[i]?.autoQueued) {
      return i;
    }
  }
  return queue.length;
}
