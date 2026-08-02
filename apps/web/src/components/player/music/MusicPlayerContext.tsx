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
import { mapMediaElementError, resolveStreamServerAudioError } from "@/components/player/shared/playbackErrors";
import { playMediaElement } from "@/lib/mediaSession";
import { remapIndexAfterReorder, reorderItems } from "@/lib/musicQueue";
import { getYoutubeAudioUrl, type TrackItem } from "@/lib/spotify";
import { recordRecentlyPlayedMusic } from "@/lib/recentlyPlayedMusic";
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
};

type MusicPlayerContextValue = {
  current: MusicQueueTrack | null;
  queue: MusicQueueTrack[];
  queueIndex: number;
  playing: boolean;
  loading: boolean;
  expanded: boolean;
  queueOpen: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  playTrack: (track: MusicQueueTrack, queue?: MusicQueueTrack[]) => void;
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
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  toggle: () => void;
  pause: () => void;
  play: () => void;
  next: () => void;
  previous: () => void;
  seek: (timeSec: number) => void;
  setExpanded: (expanded: boolean) => void;
  setQueueOpen: (open: boolean) => void;
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
  const prefetchedIdsRef = useRef<Set<string>>(new Set());
  /** Trusted catalog duration (seconds). Prefer over flaky stream metadata. */
  const catalogDurationSecRef = useRef(0);
  const [queue, setQueue] = useState<MusicQueueTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue[queueIndex] ?? null;

  const loadAndPlay = useCallback((track: MusicQueueTrack) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    recordRecentlyPlayedMusic({
      id: track.id,
      title: track.title,
      artists: track.artists,
      artistIds: track.artistIds,
      albumName: track.albumName,
      albumId: track.albumId,
      imageUrl: track.imageUrl,
      durationMs: track.durationMs,
    });
    const src = getYoutubeAudioUrl({
      artist: artistLabel(track.artists),
      title: track.title,
      album: track.albumName,
      durationMs: track.durationMs > 0 ? track.durationMs : undefined,
    });
    playIntentRef.current = true;
    setLoading(true);
    setError(null);
    setCurrentTime(0);
    const catalogSec = track.durationMs > 0 ? track.durationMs / 1000 : 0;
    catalogDurationSecRef.current = catalogSec;
    setDuration(catalogSec);
    audio.src = src;
    audio.load();
    void playMediaElement(audio).then((playError) => {
      if (playError) {
        setError(playError.message);
        playIntentRef.current = false;
        setPlaying(false);
        setLoading(false);
        return;
      }
      setPlaying(true);
    });
  }, []);

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
      prefetchedIdsRef.current = new Set([track.id]);
      setQueue(list);
      setQueueIndex(index);
      setQueueOpen(false);
      loadAndPlay(list[index] ?? track);
    },
    [loadAndPlay],
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
      prefetchedIdsRef.current = new Set([startTrack.id]);
      setQueue(list);
      setQueueIndex(index);
      setQueueOpen(false);
      loadAndPlay(startTrack);
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
      loadAndPlay(track);
    },
    [loadAndPlay, queue],
  );

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
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
      if (queue.length === 1) {
        playIntentRef.current = false;
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
          loadAndPlay(track);
        }
      }
    },
    [loadAndPlay, queue, queueIndex],
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
    void playMediaElement(audio).then((playError) => {
      if (playError) {
        setError(playError.message);
        playIntentRef.current = false;
        setPlaying(false);
        return;
      }
      setPlaying(true);
      setError(null);
    });
  }, [current]);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
    } else {
      play();
    }
  }, [pause, play, playing]);

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
    loadAndPlay(track);
  }, [loadAndPlay, queue, queueIndex]);

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
    loadAndPlay(track);
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
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    prefetchedIdsRef.current = new Set();
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
      currentTime,
      duration,
      error,
      playTrack,
      playAlbumTracks,
      playQueueIndex,
      reorderQueue,
      removeFromQueue,
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
      clear,
      current,
      currentTime,
      duration,
      error,
      expanded,
      handleSetExpanded,
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
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
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
          if (!playIntentRef.current) {
            return;
          }
          void playMediaElement(audio).then((playError) => {
            if (playError) {
              setError(playError.message);
              playIntentRef.current = false;
              setPlaying(false);
              return;
            }
            setPlaying(true);
          });
        }}
        onError={(event) => {
          playIntentRef.current = false;
          setPlaying(false);
          setLoading(false);
          void resolveStreamServerAudioError(event.currentTarget).then(setError);
        }}
        onEnded={() => {
          if (queueIndex < queue.length - 1) {
            next();
            return;
          }
          playIntentRef.current = false;
          setPlaying(false);
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
