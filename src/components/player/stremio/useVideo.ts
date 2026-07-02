// Copyright (C) 2017-2023 Smart code 203358507
// Adapted for JedFlix

import EventEmitter from "eventemitter3";
import StremioVideo from "@stremio/stremio-video";
import { useCallback, useEffect, useRef, useState } from "react";

export type VideoState = {
  manifest: unknown;
  stream: unknown;
  paused: boolean | null;
  time: number | null;
  duration: number | null;
  buffering: boolean | null;
  buffered: number | null;
  volume: number | null;
  muted: boolean | null;
  playbackSpeed: number | null;
  audioTracks: Array<{ id: string; label?: string }>;
  selectedAudioTrackId: string | null;
  subtitlesTracks: Array<{ id: string; label?: string }>;
  selectedSubtitlesTrackId: string | null;
};

const initialState: VideoState = {
  manifest: null,
  stream: null,
  paused: null,
  time: null,
  duration: null,
  buffering: null,
  buffered: null,
  volume: null,
  muted: null,
  playbackSpeed: null,
  audioTracks: [],
  selectedAudioTrackId: null,
  subtitlesTracks: [],
  selectedSubtitlesTrackId: null,
};

type VideoInstance = {
  dispatch: (action: Record<string, unknown>, options?: Record<string, unknown>) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  destroy: () => void;
};

export function useVideo() {
  const videoRef = useRef<VideoInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef(new EventEmitter());
  const [state, setState] = useState<VideoState>(initialState);

  const dispatch = useCallback(
    (action: Record<string, unknown>, options?: Record<string, unknown>) => {
      if (videoRef.current && containerRef.current) {
        videoRef.current.dispatch(action, {
          ...options,
          containerElement: containerRef.current,
        });
      }
    },
    [],
  );

  useEffect(() => {
    const video = new (StremioVideo as new () => VideoInstance)();
    videoRef.current = video;

    const onPropChanged = (name: keyof VideoState, value: unknown) => {
      setState((current) => ({ ...current, [name]: value }));
    };

    const onImplementationChanged = (manifest: { props?: string[] }) => {
      manifest.props?.forEach((propName) => {
        video.dispatch({ type: "observeProp", propName });
      });
      setState((current) => ({ ...current, manifest }));
      eventsRef.current.emit("implementationChanged", manifest);
    };

    video.on("error", (...args: unknown[]) => eventsRef.current.emit("error", ...args));
    video.on("ended", () => eventsRef.current.emit("ended"));
    video.on("propChanged", onPropChanged as (...args: unknown[]) => void);
    video.on("propValue", onPropChanged as (...args: unknown[]) => void);
    video.on("implementationChanged", onImplementationChanged as (...args: unknown[]) => void);

    return () => {
      try {
        video.destroy();
      } catch {
        // ignore destroy errors
      }
      videoRef.current = null;
    };
  }, []);

  const load = useCallback(
    (args: Record<string, unknown>) => {
      dispatch({ type: "command", commandName: "load", commandArgs: args });
    },
    [dispatch],
  );

  const unload = useCallback(() => {
    dispatch({ type: "command", commandName: "unload" });
  }, [dispatch]);

  const setPaused = useCallback(
    (paused: boolean) => dispatch({ type: "setProp", propName: "paused", propValue: paused }),
    [dispatch],
  );

  const setVolume = useCallback(
    (volume: number) => dispatch({ type: "setProp", propName: "volume", propValue: volume }),
    [dispatch],
  );

  const setMuted = useCallback(
    (muted: boolean) => dispatch({ type: "setProp", propName: "muted", propValue: muted }),
    [dispatch],
  );

  const setTime = useCallback(
    (time: number) => dispatch({ type: "setProp", propName: "time", propValue: time }),
    [dispatch],
  );

  const setPlaybackSpeed = useCallback(
    (rate: number) => dispatch({ type: "setProp", propName: "playbackSpeed", propValue: rate }),
    [dispatch],
  );

  const setSubtitlesTrack = useCallback(
    (id: string | null) => {
      dispatch({ type: "setProp", propName: "selectedSubtitlesTrackId", propValue: id });
    },
    [dispatch],
  );

  const setAudioTrack = useCallback(
    (id: string | null) => {
      dispatch({ type: "setProp", propName: "selectedAudioTrackId", propValue: id });
    },
    [dispatch],
  );

  return {
    events: eventsRef.current,
    containerRef,
    state,
    load,
    unload,
    setPaused,
    setVolume,
    setMuted,
    setTime,
    setPlaybackSpeed,
    setSubtitlesTrack,
    setAudioTrack,
  };
}
