import { useCallback, useEffect, useRef, useState } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import { guessContentType } from "@/lib/streamPlayback";
import { mapVideoJsError } from "../shared/playbackErrors";
import { toPlayerTimeMs } from "../stremio/time";
import "video.js/dist/video-js.css";
import "./videojs-overrides.css";

export type VideoState = {
  paused: boolean | null;
  time: number | null;
  duration: number | null;
  buffering: boolean | null;
};

const initialState: VideoState = {
  paused: null,
  time: null,
  duration: null,
  buffering: null,
};

type LoadArgs = {
  url: string;
  filename: string;
  autoplay?: boolean;
  startTimeSeconds?: number;
};

type EventHandler = (...args: unknown[]) => void;

export function useVideoJs() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const listenersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const [state, setState] = useState<VideoState>(initialState);

  const emit = useCallback((event: string, ...args: unknown[]) => {
    listenersRef.current.get(event)?.forEach((handler) => {
      handler(...args);
    });
  }, []);

  const on = useCallback((event: string, handler: EventHandler) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)?.add(handler);
  }, []);

  const off = useCallback((event: string, handler: EventHandler) => {
    listenersRef.current.get(event)?.delete(handler);
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    const player = videojs(element, {
      controls: false,
      autoplay: false,
      preload: "auto",
      fill: true,
      playsinline: true,
      fluid: false,
      errorDisplay: false,
      html5: {
        vhs: {
          overrideNative: !videojs.browser.IS_SAFARI,
        },
      },
    });

    playerRef.current = player;

    const syncState = () => {
      setState({
        paused: player.paused(),
        time: toPlayerTimeMs(player.currentTime() ?? 0),
        duration: toPlayerTimeMs(player.duration() ?? 0),
        buffering: player.readyState() < 3 && !player.paused(),
      });
    };

    const onError = () => {
      const mediaError = player.error();
      const message = mapVideoJsError(mediaError?.code ?? null);
      emit("error", message, mediaError?.code ?? null);
      syncState();
    };

    player.on("error", onError);
    player.on("ended", () => emit("ended"));
    player.on("timeupdate", syncState);
    player.on("loadedmetadata", syncState);
    player.on("play", syncState);
    player.on("pause", syncState);
    player.on("waiting", () => setState((current) => ({ ...current, buffering: true })));
    player.on("canplay", () => setState((current) => ({ ...current, buffering: false })));

    return () => {
      if (!player.isDisposed()) {
        player.dispose();
      }
      playerRef.current = null;
    };
  }, [emit]);

  const load = useCallback((args: LoadArgs) => {
    const player = playerRef.current;
    if (!player) {
      return;
    }

    player.src({
      src: args.url,
      type: guessContentType(args.filename),
    });

    const startSeconds = args.startTimeSeconds ?? 0;
    const shouldAutoplay = args.autoplay ?? true;

    const applyStart = () => {
      if (startSeconds > 0) {
        player.currentTime(startSeconds);
      }
      if (shouldAutoplay) {
        void player.play()?.catch(() => {
          // Autoplay may be blocked until user interaction.
        });
      }
    };

    if (player.readyState() >= 1) {
      applyStart();
    } else {
      player.one("loadedmetadata", applyStart);
    }
  }, []);

  const unload = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) {
      return;
    }
    player.pause();
    player.reset();
    setState(initialState);
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) {
      return;
    }
    if (paused) {
      player.pause();
    } else {
      void player.play()?.catch(() => {
        // Ignore play rejection.
      });
    }
  }, []);

  const setTime = useCallback((timeMs: number) => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) {
      return;
    }
    player.currentTime(timeMs / 1000);
  }, []);

  return {
    videoRef,
    state,
    load,
    unload,
    setPaused,
    setTime,
    events: { on, off },
  };
}
