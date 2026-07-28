import { useEffect, useMemo, useState } from "react";
import { RealDebridError, resolveRealDebridStream } from "@/lib/realDebrid";
import {
  getPlaybackUrl,
  type ResolveRequest,
  type StreamResult,
  type StreamSource,
} from "@/lib/streamApi";

export type StreamResolveState = {
  status: "idle" | "downloading" | "ready" | "failed";
  progress?: string;
  error?: string;
  errorCode?: string;
  stream?: StreamResult;
  playbackUrl?: string;
  requestKey?: string;
};

const idleState: StreamResolveState = { status: "idle" };

export function useStreamResolve(request: ResolveRequest | null, source: StreamSource | null = null) {
  const [state, setState] = useState<StreamResolveState>({ status: "idle" });
  const requestKey = useMemo(() => {
    if (!request?.magnet) {
      return null;
    }

    return [
      request.type,
      request.imdbId,
      request.season ?? "",
      request.episode ?? "",
      request.infoHash || request.magnet,
      request.realDebridToken ?? "",
    ].join(":");
  }, [
    request?.episode,
    request?.imdbId,
    request?.infoHash,
    request?.magnet,
    request?.realDebridToken,
    request?.season,
    request?.type,
  ]);

  useEffect(() => {
    if (!request || !requestKey) {
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
      } catch (error) {
        if (!cancelled) {
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
  }, [request, requestKey, source]);

  if (!requestKey) {
    return idleState;
  }
  if (state.requestKey !== requestKey) {
    return {
      status: "downloading",
      progress: "Resolving selected stream",
      requestKey,
    };
  }
  return state;
}
