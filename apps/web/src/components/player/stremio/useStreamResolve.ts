import { useEffect, useMemo, useState } from "react";
import { formatStreamFailure } from "@/components/player/shared/playbackErrors";
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

function sourceKey(source: StreamSource | null, request: ResolveRequest | null): string | null {
  if (!request || !source) {
    return null;
  }
  const identity =
    source.abbPostUrl ||
    request.abbPostUrl ||
    source.infoHash ||
    request.infoHash ||
    source.magnet ||
    request.magnet;
  if (!identity) {
    return null;
  }
  return [
    request.type,
    request.imdbId ?? "",
    request.season ?? "",
    request.episode ?? "",
    identity,
    request.fileIdx ?? source.fileIdx ?? "",
    request.realDebridToken ?? "",
  ].join(":");
}

export function useStreamResolve(request: ResolveRequest | null, source: StreamSource | null = null) {
  const [state, setState] = useState<StreamResolveState>({ status: "idle" });
  const requestKey = useMemo(() => sourceKey(source, request), [request, source]);

  useEffect(() => {
    if (!request || !requestKey || !source) {
      return;
    }

    const currentRequestKey = requestKey;
    let cancelled = false;
    const controller = new AbortController();

    async function run(currentRequest: NonNullable<typeof request>) {
      setState({
        status: "downloading",
        progress: "Resolving selected stream with Real Debrid…",
        requestKey: currentRequestKey,
      });
      try {
        const stream = await resolveRealDebridStream(
          source!,
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
          const code = error instanceof RealDebridError ? error.code : undefined;
          const message = formatStreamFailure(error);
          setState({
            status: "failed",
            error: code ? `${message} [${code}]` : message,
            errorCode: code,
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
      progress: "Resolving selected stream with Real Debrid…",
      requestKey,
    };
  }
  return state;
}
