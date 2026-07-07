import { createStreamClient } from "@jedflix/stream-client";

const streamClient = createStreamClient({
  apiBase: import.meta.env.VITE_STREAM_API_URL ?? "/stream-api",
  apiKey: import.meta.env.VITE_STREAM_API_KEY,
});

export type {
  ResolveJob,
  ResolveRequest,
  SourcesRequest,
  StreamResult,
  StreamSource,
} from "@jedflix/stream-client";

export type { StreamMode } from "@jedflix/shared";

export const {
  resolveStreamUrl,
  getPlaybackUrl,
  getExternalPlaybackUrl,
  fetchSources,
  startResolve,
  pollResolve,
} = streamClient;
