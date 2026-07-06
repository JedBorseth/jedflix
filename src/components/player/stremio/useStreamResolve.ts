import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPlaybackUrl,
  pollResolve,
  startResolve,
  type ResolveJob,
  type ResolveRequest,
  type StreamResult,
} from "@/lib/streamApi";

export type StreamResolveState = {
  status: ResolveJob["status"] | "idle";
  progress?: string;
  error?: string;
  stream?: StreamResult;
  playbackUrl?: string;
};

const idleState: StreamResolveState = { status: "idle" };

export function useStreamResolve(request: ResolveRequest | null) {
  const [state, setState] = useState<StreamResolveState>({ status: "idle" });
  const activeJobRef = useRef<string | null>(null);
  const activeRequestKeyRef = useRef<string | null>(null);
  const requestKey = useMemo(() => {
    if (!request?.magnet) {
      return null;
    }

    return [
      request.type,
      request.imdbId,
      request.season ?? "",
      request.episode ?? "",
      request.mode,
      request.infoHash || request.magnet,
    ].join(":");
  }, [
    request?.episode,
    request?.imdbId,
    request?.infoHash,
    request?.magnet,
    request?.mode,
    request?.season,
    request?.type,
  ]);

  const applyJob = useCallback((job: ResolveJob) => {
    const playbackUrl = job.stream ? getPlaybackUrl(job.stream) : undefined;
    setState((current) => {
      if (
        current.status === job.status &&
        current.progress === job.progress &&
        current.error === job.error &&
        current.playbackUrl === playbackUrl
      ) {
        return current;
      }
      return {
        status: job.status,
        progress: job.progress,
        error: job.error,
        stream: job.stream,
        playbackUrl,
      };
    });
  }, []);

  useEffect(() => {
    if (!request || !requestKey) {
      activeJobRef.current = null;
      activeRequestKeyRef.current = null;
      return;
    }

    let cancelled = false;

    async function run(currentRequest: NonNullable<typeof request>) {
      setState({ status: "downloading", progress: "Resolving selected stream" });
      try {
        const started =
          activeRequestKeyRef.current === requestKey && activeJobRef.current
            ? await pollResolve(activeJobRef.current)
            : await startResolve(currentRequest);
        if (cancelled) {
          return;
        }
        activeJobRef.current = started.jobId;
        activeRequestKeyRef.current = requestKey;
        applyJob(started);

        while (!cancelled) {
          const job = await pollResolve(started.jobId);
          if (cancelled) {
            return;
          }
          applyJob(job);
          if (job.status === "ready" || job.status === "failed") {
            activeJobRef.current = null;
            activeRequestKeyRef.current = null;
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      } catch (error) {
        if (!cancelled) {
          activeJobRef.current = null;
          activeRequestKeyRef.current = null;
          setState({
            status: "failed",
            error: error instanceof Error ? error.message : "Failed to resolve stream",
          });
        }
      }
    }

    void run(request);
    return () => {
      cancelled = true;
    };
  }, [
    applyJob,
    request,
    requestKey,
  ]);

  return requestKey ? state : idleState;
}
