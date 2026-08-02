import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMediaSession } from "@/hooks/useMediaSession";
import { mapMediaElementError } from "@/components/player/shared/playbackErrors";
import { playMediaElement } from "@/lib/mediaSession";
import { getYoutubeAudioUrl, type TrackItem } from "@/lib/spotify";
import { recordRecentlyPlayedMusic } from "@/lib/recentlyPlayedMusic";

export type MusicQueueTrack = {
  id: string;
  title: string;
  artists: string[];
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
  currentTime: number;
  duration: number;
  error: string | null;
  playTrack: (track: MusicQueueTrack, queue?: MusicQueueTrack[]) => void;
  playAlbumTracks: (tracks: TrackItem[], album: {
    id: string;
    name: string;
    imageUrl: string;
    artists: string[];
  }, startIndex?: number) => void;
  toggle: () => void;
  pause: () => void;
  play: () => void;
  next: () => void;
  previous: () => void;
  seek: (timeSec: number) => void;
  setExpanded: (expanded: boolean) => void;
  clear: () => void;
};

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

function artistLabel(artists: string[]): string {
  return artists.filter(Boolean).join(", ") || "Unknown artist";
}

function toQueueTrack(
  track: TrackItem,
  album: { id: string; name: string; imageUrl: string; artists: string[] },
): MusicQueueTrack {
  return {
    id: track.id || `${album.id}-${track.discNumber}-${track.trackNumber}-${track.name}`,
    title: track.name,
    artists: track.artists.length > 0 ? track.artists : album.artists,
    albumName: album.name,
    albumId: album.id,
    imageUrl: album.imageUrl,
    durationMs: track.durationMs,
  };
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playIntentRef = useRef(false);
  const [queue, setQueue] = useState<MusicQueueTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [streamSrc, setStreamSrc] = useState<string | null>(null);

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
    setDuration(track.durationMs > 0 ? track.durationMs / 1000 : 0);
    setStreamSrc(src);
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
      const list = nextQueue && nextQueue.length > 0 ? nextQueue : [track];
      const index = Math.max(
        0,
        list.findIndex((item) => item.id === track.id),
      );
      setQueue(list);
      setQueueIndex(index >= 0 ? index : 0);
      loadAndPlay(list[index >= 0 ? index : 0] ?? track);
    },
    [loadAndPlay],
  );

  const playAlbumTracks = useCallback(
    (
      tracks: TrackItem[],
      album: { id: string; name: string; imageUrl: string; artists: string[] },
      startIndex = 0,
    ) => {
      const list = tracks.map((track) => toQueueTrack(track, album));
      if (list.length === 0) {
        return;
      }
      const index = Math.min(Math.max(startIndex, 0), list.length - 1);
      setQueue(list);
      setQueueIndex(index);
      loadAndPlay(list[index]!);
    },
    [loadAndPlay],
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

  const seek = useCallback((timeSec: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const nextTime = Math.max(0, Math.min(audio.duration || duration || 0, timeSec));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [duration]);

  const clear = useCallback(() => {
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
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setStreamSrc(null);
  }, []);

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
    onSeek: seek,
    onSeekBy: (delta) => seek(currentTime + delta),
    onPreviousTrack: previous,
    onNextTrack: next,
    onStop: pause,
  });

  const value = useMemo<MusicPlayerContextValue>(
    () => ({
      current,
      queue,
      queueIndex,
      playing,
      loading,
      expanded,
      currentTime,
      duration,
      error,
      playTrack,
      playAlbumTracks,
      toggle,
      pause,
      play,
      next,
      previous,
      seek,
      setExpanded,
      clear,
    }),
    [
      clear,
      current,
      currentTime,
      duration,
      error,
      expanded,
      loading,
      next,
      pause,
      play,
      playAlbumTracks,
      playTrack,
      playing,
      previous,
      queue,
      queueIndex,
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
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setDuration(audio.duration);
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
          setError(mapMediaElementError(event.currentTarget));
        }}
        onEnded={() => {
          if (queueIndex < queue.length - 1) {
            next();
            return;
          }
          playIntentRef.current = false;
          setPlaying(false);
        }}
      >
        {streamSrc ? <source src={streamSrc} /> : null}
      </audio>
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
