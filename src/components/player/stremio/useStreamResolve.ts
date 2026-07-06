import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RealDebridError, resolveRealDebridStream } from "@/lib/realDebrid";
import {
  getPlaybackUrl,
  pollResolve,
  startResolve,
  type ResolveJob,
  type ResolveRequest,
  type StreamResult,
  type StreamSource,
} from "@/lib/streamApi";

export type StreamResolveState = {
  status: ResolveJob["status"] | "idle";
  progress?: string;
  error?: string;
  errorCode?: string;
  stream?: StreamResult;
  playbackUrl?: string;
  requestKey?: string;
};

const idleState: StreamResolveState = { status: "idle" };
const PROXY_RESOLVE_TIMEOUT_MS = 10 * 60 * 1000;

export function useStreamResolve(request: ResolveRequest | null, source: StreamSource | null = null) {
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
      request.realDebridToken ?? "",
    ].join(":");
  }, [
    request?.episode,
    request?.imdbId,
    request?.infoHash,
    request?.magnet,
    request?.mode,
    request?.realDebridToken,
    request?.season,
    request?.type,
  ]);

  const applyJob = useCallback((job: ResolveJob, currentRequestKey: string) => {
    const playbackUrl = job.stream ? getPlaybackUrl(job.stream) : undefined;
    setState((current) => {
      if (
        current.status === job.status &&
        current.progress === job.progress &&
        current.error === job.error &&
        current.errorCode === job.errorCode &&
        current.playbackUrl === playbackUrl
      ) {
        return current;
      }
      return {
        status: job.status,
        progress: job.progress,
        error: job.error,
        errorCode: job.errorCode,
        stream: job.stream,
        playbackUrl,
        requestKey: currentRequestKey,
      };
    });
  }, []);

  useEffect(() => {
    if (!request || !requestKey) {
      activeJobRef.current = null;
      activeRequestKeyRef.current = null;
      return;
    }

    const currentRequestKey = requestKey;
    let cancelled = false;
    const controller = new AbortController();

    async function run(currentRequest: NonNullable<typeof request>) {
      setState({
        status: "downloading",
        progress: "Resolving selected stream",
        requestKey: currentRequestKey,
      });
      try {
        if (currentRequest.mode === "direct") {
          if (!source) {
            throw new Error("No stream source selected.");
          }
          const stream = await resolveRealDebridStream(
            source,
            currentRequest,
            currentRequest.realDebridToken ?? "",
            {
              signal: controller.signal,
              onProgress: (progress) => {
                if (!cancelled) {
                  setState((current) => ({ ...current, status: "downloading", progress }));
                }
              },
            },
          );
          if (cancelled) {
            return;
          }
          setState({
            status: "ready",
            progress: "Stream ready",
            stream,
            playbackUrl: getPlaybackUrl(stream),
            requestKey: currentRequestKey,
          });
          return;
        }

        const startedAt = Date.now();
        const started =
          activeRequestKeyRef.current === currentRequestKey && activeJobRef.current
            ? await pollResolve(activeJobRef.current)
            : await startResolve(currentRequest, currentRequest.realDebridToken);
        if (cancelled) {
          return;
        }
        activeJobRef.current = started.jobId;
        activeRequestKeyRef.current = currentRequestKey;
        applyJob(started, currentRequestKey);

        while (!cancelled) {
          if (Date.now() - startedAt > PROXY_RESOLVE_TIMEOUT_MS) {
            throw new RealDebridError("timeout", "Stream resolve timed out.");
          }
          const job = await pollResolve(started.jobId);
          if (cancelled) {
            return;
          }
          applyJob(job, currentRequestKey);
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
            errorCode: error instanceof RealDebridError ? error.code : undefined,
            requestKey: currentRequestKey,
          });
        }
      }
    }

    void run(request);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applyJob, request, requestKey, source]);

  if (!requestKey) {
    return idleState;
  }
  if (state.requestKey !== requestKey) {
    const loadingState: StreamResolveState = {
      status: "downloading",
      progress: "Resolving selected stream",
      requestKey,
    };
    return loadingState;
  }
  return state;
}
