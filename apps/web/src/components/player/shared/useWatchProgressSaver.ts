import { useLayoutEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { MediaType } from "@/lib/types";

const SAVE_INTERVAL_MS = 10_000;

export function useWatchProgressSaver(
  movieId: number,
  mediaType: MediaType,
  season?: number,
  episode?: number,
) {
  const upsertProgress = useMutation(api.watchHistory.upsertProgress);

  const saver = useMemo(() => {
    let latest: number | undefined;
    let lastSaved: number | undefined;
    let lastSavedAt = -Infinity;

    const record = (seconds: number) => {
      if (Number.isFinite(seconds) && seconds > 0) {
        latest = seconds;
      }
    };

    const flush = () => {
      if (latest === undefined || latest === lastSaved) {
        return;
      }
      lastSaved = latest;
      lastSavedAt = performance.now();
      void upsertProgress({
        movieId,
        mediaType,
        progressSeconds: latest,
        season,
        episode,
      }).catch(() => {});
    };

    return {
      update(seconds: number) {
        record(seconds);
        if (performance.now() - lastSavedAt >= SAVE_INTERVAL_MS) {
          flush();
        }
      },
      flush,
      finish(seconds: number) {
        record(seconds);
        flush();
      },
    };
  }, [episode, mediaType, movieId, season, upsertProgress]);

  useLayoutEffect(() => saver.flush, [saver]);

  return saver;
}
