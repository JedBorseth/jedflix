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
import { useMusicInteractionLog } from "@/lib/musicInteractions";
import { pickMusicDurationSec } from "@/lib/musicDuration";
import {
  exclusionIdsFromTracks,
  generateInfiniteQueueTracks,
  INFINITE_QUEUE_PREVIEW_SIZE,
  remainingUpcomingCount,
  shouldAppendInfiniteRecommendations,
  uniqueQueueTracks,
} from "@/lib/infiniteQueueRecommendations";
import {
  fetchYoutubeAudioMetadata,
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
  /** Next auto-queued recommendations, shown before they join the playable queue. */
  upcomingRecommendations: MusicQueueTrack[];
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
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
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
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

const MUSIC_VOLUME_STORAGE_KEY = "jedflix.music.volume";
const MUSIC_MUTED_STORAGE_KEY = "jedflix.music.muted";

function artistLabel(artists: string[]): string {
  return artists.filter(Boolean).join(", ") || "Unknown artist";
}

function storedMusicVolume(): number {
  const raw = window.localStorage.getItem(MUSIC_VOLUME_STORAGE_KEY);
  if (raw === null) {
    return 1;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
}

function storedMusicMuted(): boolean {
  return window.localStorage.getItem(MUSIC_MUTED_STORAGE_KEY) === "true";
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
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
    track.artistIds && track.artistIds.length > 0
      ? track.artistIds
      : album.artistIds;
  return {
    id:
      track.id ||
      `${album.id}-${track.discNumber}-${track.trackNumber}-${track.name}`,
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
  /** Trusted playback duration (seconds). Prefer yt-dlp, then catalog — never inflated HTML5. */
  const playbackDurationSecRef = useRef(0);
  const resolvedDurationSecByIdRef = useRef<Map<string, number>>(new Map());
  const resumeAtSecRef = useRef(0);
  const errorRetryRef = useRef(0);
  const metadataAbortRef = useRef<AbortController | null>(null);
  /** Prevents double-advance when catalog end and stream `ended` both fire. */
  const catalogEndedRef = useRef(false);
  const [queue, setQueue] = useState<MusicQueueTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [infiniteQueue, setInfiniteQueueState] = useState(false);
  const [upcomingRecommendations, setUpcomingRecommendations] = useState<
    MusicQueueTrack[]
  >([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(storedMusicVolume);
  const [muted, setMutedState] = useState(storedMusicMuted);
  const [error, setError] = useState<string | null>(null);
  const queueIndexRef = useRef(0);
  queueIndexRef.current = queueIndex;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const infiniteQueueRef = useRef(false);
  infiniteQueueRef.current = infiniteQueue;
  const upcomingRecommendationsRef = useRef<MusicQueueTrack[]>([]);
  upcomingRecommendationsRef.current = upcomingRecommendations;
  /** Recently played tracks for Infinite Queue recommendation context. */
  const playHistoryRef = useRef<MusicQueueTrack[]>([]);
  const infiniteRefillInFlightRef = useRef(false);
  const logMusic = useMusicInteractionLog();

  const current = useMemo(() => {
    const track = queue[queueIndex] ?? null;
    return track ? withCachedArtwork(track) : null;
  }, [queue, queueIndex]);

  const applyPlayResult = useCallback(
    (
      audio: HTMLAudioElement,
      generation: number,
      result: Awaited<ReturnType<typeof playMediaElement>>,
    ) => {
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
    (
      track: MusicQueueTrack,
      options?: {
        immediatePlay?: boolean;
        resumeAtSec?: number;
        retrying?: boolean;
      },
    ) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      const playable = withCachedArtwork(track);
      const generation = ++loadGenerationRef.current;
      if (!options?.retrying) {
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
        const history = playHistoryRef.current.filter(
          (item) => item.id !== playable.id,
        );
        history.push(playable);
        playHistoryRef.current = history.slice(-20);
        logMusic({
          kind: "play",
          trackId: playable.id,
          title: playable.title,
          artists: playable.artists,
        });
      }
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
      resumeAtSecRef.current =
        options?.resumeAtSec && options.resumeAtSec > 1
          ? options.resumeAtSec
          : 0;
      if (!options?.retrying) {
        errorRetryRef.current = 0;
      }
      setLoading(true);
      setError(null);
      setCurrentTime(resumeAtSecRef.current);
      const catalogSec =
        playable.durationMs > 0 ? playable.durationMs / 1000 : 0;
      const resolvedSec =
        resolvedDurationSecByIdRef.current.get(playable.id) ?? 0;
      const trustedSec = pickMusicDurationSec({ catalogSec, resolvedSec });
      playbackDurationSecRef.current = trustedSec;
      catalogEndedRef.current = false;
      setDuration(trustedSec);
      metadataAbortRef.current?.abort();
      const metadataAbort = new AbortController();
      metadataAbortRef.current = metadataAbort;
      void fetchYoutubeAudioMetadata(src, {
        signal: metadataAbort.signal,
      }).then((meta) => {
        if (
          generation !== loadGenerationRef.current ||
          metadataAbort.signal.aborted
        ) {
          return;
        }
        if (meta.durationMs && meta.durationMs > 0) {
          const nextResolved = meta.durationMs / 1000;
          resolvedDurationSecByIdRef.current.set(playable.id, nextResolved);
          const nextTrusted = pickMusicDurationSec({
            catalogSec,
            resolvedSec: nextResolved,
          });
          playbackDurationSecRef.current = nextTrusted;
          setDuration(nextTrusted);
        }
      });
      // Assigning src selects the resource. Avoid audio.load() here — it aborts a
      // play() started in the same Media Session turn on iOS and can leave the
      // element in MEDIA_ERR_SRC_NOT_SUPPORTED ("operation is not supported").
      audio.src = src;
      if (options?.immediatePlay) {
        startPlayback(audio, generation);
      }
    },
    [logMusic, startPlayback],
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
      logMusic({
        kind: "select",
        trackId: track.id,
        title: track.title,
        artists: track.artists,
      });
      setQueue(stripQueueArtwork(list, index));
      setQueueIndex(index);
      setQueueOpen(false);
      loadAndPlay(list[index] ?? track, { immediatePlay: true });
      return session;
    },
    [loadAndPlay, logMusic],
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
        playbackDurationSecRef.current = 0;
        setError(null);
        return;
      }

      const removingCurrent = index === queueIndex;
      const nextQueue = queue.filter((_, i) => i !== index);
      const nextIndex =
        index < queueIndex
          ? queueIndex - 1
          : Math.min(queueIndex, nextQueue.length - 1);
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
    upcomingRecommendationsRef.current = [];
    setUpcomingRecommendations([]);
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
    const remaining = remainingUpcomingCount(currentQueue.length, index);
    const currentTrack = currentQueue[index] ?? null;
    if (!currentTrack) {
      return;
    }

    infiniteRefillInFlightRef.current = true;
    const session = queueSessionRef.current;
    try {
      const recent = playHistoryRef.current.slice(-8);
      const recentArtistNames = [
        ...recent,
        ...currentQueue.slice(Math.max(0, index - 3), index + 1),
      ]
        .map((track) => track.artists[0] ?? "")
        .filter(Boolean);

      const fetchRecommendations = async (
        excludeIds: Set<string>,
        limit: number,
      ) => {
        return generateInfiniteQueueTracks({
          current: currentTrack,
          recent,
          excludeIds,
          recentArtistNames,
          limit,
        });
      };

      let playableQueue = currentQueue;
      if (shouldAppendInfiniteRecommendations(remaining)) {
        let toAppend = upcomingRecommendationsRef.current;
        if (toAppend.length === 0) {
          toAppend = await fetchRecommendations(
            exclusionIdsFromTracks(playableQueue, playHistoryRef.current),
            INFINITE_QUEUE_PREVIEW_SIZE,
          );
        }
        if (session !== queueSessionRef.current || !infiniteQueueRef.current) {
          return;
        }
        const added = uniqueQueueTracks(
          toAppend,
          playableQueue.map((track) => track.id),
          INFINITE_QUEUE_PREVIEW_SIZE,
          playableQueue,
        ).map((track) => ({ ...track, autoQueued: true }));
        if (added.length > 0) {
          playableQueue = [...playableQueue, ...added];
          queueRef.current = playableQueue;
          setQueue(playableQueue);
        }
        upcomingRecommendationsRef.current = [];
        setUpcomingRecommendations([]);
      }

      const previewNeed =
        INFINITE_QUEUE_PREVIEW_SIZE - upcomingRecommendationsRef.current.length;
      if (previewNeed > 0) {
        const preview = await fetchRecommendations(
          exclusionIdsFromTracks(
            playableQueue,
            upcomingRecommendationsRef.current,
            playHistoryRef.current,
          ),
          previewNeed,
        );
        if (session !== queueSessionRef.current || !infiniteQueueRef.current) {
          return;
        }
        const nextPreview = uniqueQueueTracks(
          [...upcomingRecommendationsRef.current, ...preview],
          playableQueue.map((track) => track.id),
          INFINITE_QUEUE_PREVIEW_SIZE,
          playableQueue,
        );
        upcomingRecommendationsRef.current = nextPreview;
        setUpcomingRecommendations(nextPreview);
      }
    } catch {
      // Recommendation / network failures must never interrupt playback.
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
    const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (audio.error || !audio.src || audio.readyState === 0) {
      loadAndPlay(current, { immediatePlay: true, resumeAtSec: resumeAt });
      return;
    }
    const generation = loadGenerationRef.current;
    void playMediaElement(audio).then((result) => {
      if (generation !== loadGenerationRef.current || !playIntentRef.current) {
        return;
      }
      if (
        result.status === "error" ||
        (result.status === "aborted" && audio.paused)
      ) {
        // iOS often rejects the first play() after a lock-screen pause while the
        // tab was frozen — reload and retry with a fresh src in the same gesture.
        const retryAt = Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : resumeAt;
        loadAndPlay(current, { immediatePlay: true, resumeAtSec: retryAt });
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
        loadAndPlay(current, {
          immediatePlay: true,
          resumeAtSec: Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : 0,
        });
        return;
      }
      const generation = loadGenerationRef.current;
      void playMediaElement(audio).then((result) => {
        if (!playIntentRef.current) {
          return;
        }
        if (
          result.status === "error" ||
          (result.status === "aborted" && audio.paused)
        ) {
          loadAndPlay(current, {
            immediatePlay: true,
            resumeAtSec: Number.isFinite(audio.currentTime)
              ? audio.currentTime
              : 0,
          });
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
    const currentTrack = queue[queueIndex];
    if (currentTrack && !catalogEndedRef.current) {
      const catalogSec = playbackDurationSecRef.current;
      const audio = audioRef.current;
      const progress =
        catalogSec > 0 && audio ? audio.currentTime / catalogSec : 0;
      logMusic({
        kind: progress >= 0.8 ? "complete" : "skip",
        trackId: currentTrack.id,
        title: currentTrack.title,
        artists: currentTrack.artists,
      });
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
  }, [loadAndPlay, logMusic, queue, queueIndex]);

  /** Advance on catalog end (Spotify length) or real stream EOF — YouTube often outlasts the song. */
  const handleTrackEnded = useCallback(() => {
    if (catalogEndedRef.current) {
      return;
    }
    catalogEndedRef.current = true;
    const currentTrack = queue[queueIndex];
    if (currentTrack) {
      logMusic({
        kind: "complete",
        trackId: currentTrack.id,
        title: currentTrack.title,
        artists: currentTrack.artists,
      });
    }
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
  }, [logMusic, next, queue, queueIndex]);

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

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.min(1, Math.max(0, nextVolume));
    setVolumeState(clamped);
    window.localStorage.setItem(MUSIC_VOLUME_STORAGE_KEY, String(clamped));
    if (clamped > 0) {
      setMutedState(false);
      window.localStorage.setItem(MUSIC_MUTED_STORAGE_KEY, "false");
    }
    const audio = audioRef.current;
    if (audio) {
      audio.volume = clamped;
      if (clamped > 0) {
        audio.muted = false;
      }
    }
  }, []);

  const setMuted = useCallback((nextMuted: boolean) => {
    setMutedState(nextMuted);
    window.localStorage.setItem(MUSIC_MUTED_STORAGE_KEY, String(nextMuted));
    const audio = audioRef.current;
    if (audio) {
      audio.muted = nextMuted;
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = volume;
    audio.muted = muted;
  }, [muted, volume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.defaultPrevented || !current) {
        return;
      }
      if (isTextEntryTarget(event.target)) {
        return;
      }
      event.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [current, toggle]);

  const clear = useCallback(() => {
    playIntentRef.current = false;
    loadGenerationRef.current += 1;
    metadataAbortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    prefetchedIdsRef.current = new Set();
    playbackDurationSecRef.current = 0;
    catalogEndedRef.current = false;
    queueSessionRef.current += 1;
    queueDirtyRef.current = false;
    playHistoryRef.current = [];
    upcomingRecommendationsRef.current = [];
    infiniteRefillInFlightRef.current = false;
    setQueue([]);
    setQueueIndex(0);
    setPlaying(false);
    setLoading(false);
    setExpanded(false);
    setQueueOpen(false);
    setUpcomingRecommendations([]);
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
    const queued = upcomingTracksForPrefetch(queue, queueIndex, 2);
    const previewNeed = Math.max(0, 2 - queued.length);
    const upcoming = [
      ...queued,
      ...upcomingRecommendations.slice(0, previewNeed),
    ];
    if (upcoming.length === 0) {
      return;
    }
    const controller = new AbortController();
    void prefetchYoutubeAudioTracks(upcoming, {
      signal: controller.signal,
      alreadyPrefetched: prefetchedIdsRef.current,
    }).then((result) => {
      for (const [id, ms] of Object.entries(result.durationMsByTrackId)) {
        resolvedDurationSecByIdRef.current.set(id, ms / 1000);
      }
    });
    return () => controller.abort();
  }, [queue, queueIndex, upcomingRecommendations]);

  useEffect(() => {
    if (!infiniteQueue) {
      upcomingRecommendationsRef.current = [];
      setUpcomingRecommendations([]);
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
    actionHandlerKey: current?.id,
    positionMinIntervalMs: 1000,
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
      upcomingRecommendations,
      currentTime,
      duration,
      volume,
      muted,
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
      setVolume,
      setMuted,
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
      upcomingRecommendations,
      loading,
      muted,
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
      setMuted,
      setVolume,
      setInfiniteQueue,
      toggle,
      volume,
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
          // Only clear playing when pause was intentional. Src swaps and iOS
          // background glitches fire pause while playIntent remains — keeping
          // Media Session in "playing" prevents lock-screen controls from
          // falling back to skip ±10s.
          if (!playIntentRef.current) {
            setPlaying(false);
          }
        }}
        onWaiting={() => setLoading(true)}
        onCanPlay={(event) => {
          setLoading(false);
          const audio = event.currentTarget;
          if (resumeAtSecRef.current > 1) {
            const max =
              playbackDurationSecRef.current > 0
                ? playbackDurationSecRef.current
                : audio.duration;
            if (Number.isFinite(max) && max > 0) {
              try {
                audio.currentTime = Math.min(resumeAtSecRef.current, max);
                resumeAtSecRef.current = 0;
              } catch {
                // Safari may reject seeks until later in the load cycle.
              }
            }
          }
          if (playIntentRef.current && audio.paused && !audio.error) {
            startPlayback(audio, loadGenerationRef.current);
          }
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          const trustedSec = playbackDurationSecRef.current;
          if (trustedSec > 0) {
            setCurrentTime(Math.min(time, trustedSec));
            // YouTube files can outlast the real song; advance at yt-dlp/catalog end.
            if (time >= trustedSec - 0.25) {
              handleTrackEnded();
            }
            return;
          }
          setCurrentTime(time);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          // Never copy HTML5 audio.duration — proxied YouTube AAC often reports ~2×.
          setLoading(false);
          if (resumeAtSecRef.current > 1) {
            const max =
              playbackDurationSecRef.current > 0
                ? playbackDurationSecRef.current
                : audio.duration;
            if (Number.isFinite(max) && max > 0) {
              try {
                audio.currentTime = Math.min(resumeAtSecRef.current, max);
              } catch {
                // Seek on canplay instead.
              }
            }
          }
          if (!playIntentRef.current || !audio.paused) {
            return;
          }
          startPlayback(audio, loadGenerationRef.current);
        }}
        onError={(event) => {
          const audio = event.currentTarget;
          const track = queueRef.current[queueIndexRef.current];
          if (playIntentRef.current && track && errorRetryRef.current < 1) {
            errorRetryRef.current += 1;
            const resumeAt = Number.isFinite(audio.currentTime)
              ? audio.currentTime
              : 0;
            loadAndPlay(track, {
              immediatePlay: true,
              resumeAtSec: resumeAt,
              retrying: true,
            });
            return;
          }
          // Don't clear playIntent — lock-screen Play after a background stream
          // kill must still be able to reload. Only intentional pause clears intent.
          setPlaying(false);
          setLoading(false);
          const generation = loadGenerationRef.current;
          void resolveStreamServerAudioError(audio).then((message) => {
            if (generation !== loadGenerationRef.current) {
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
function findManualInsertIndex(
  queue: MusicQueueTrack[],
  currentIndex: number,
): number {
  for (let i = currentIndex + 1; i < queue.length; i += 1) {
    if (queue[i]?.autoQueued) {
      return i;
    }
  }
  return queue.length;
}
