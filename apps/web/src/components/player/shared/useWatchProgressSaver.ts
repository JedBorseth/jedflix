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
    let lastSaved: { seconds: number; sequence: number } | undefined;
    let inFlight: typeof lastSaved;
    let sequence = 0;
    let lastAttemptAt = -Infinity;

    const record = (seconds: number) => {
      if (Number.isFinite(seconds) && seconds > 0) {
        latest = seconds;
      }
    };

    const flush = () => {
      if (latest === undefined || latest === (inFlight ?? lastSaved)?.seconds) {
        return;
      }
      const write = { seconds: latest, sequence: ++sequence };
      inFlight = write;
      lastAttemptAt = performance.now();
      void upsertProgress({
        movieId,
        mediaType,
        progressSeconds: write.seconds,
        season,
        episode,
      }).then(
        () => {
          if (!lastSaved || write.sequence > lastSaved.sequence) {
            lastSaved = write;
          }
          if (inFlight === write) {
            inFlight = undefined;
          }
        },
        () => {
          if (inFlight === write) {
            inFlight = undefined;
          }
        },
      );
    };

    return {
      update(seconds: number) {
        record(seconds);
        if (performance.now() - lastAttemptAt >= SAVE_INTERVAL_MS) {
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
