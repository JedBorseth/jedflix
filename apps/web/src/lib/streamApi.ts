import { createStreamClient } from "@jedflix/stream-client";

const streamClient = createStreamClient({
  apiBase: import.meta.env.VITE_STREAM_API_URL ?? "/stream-api",
  apiKey: import.meta.env.VITE_STREAM_API_KEY,
});

export type {
  ResolveRequest,
  SourcesRequest,
  StreamResult,
  StreamSource,
} from "@jedflix/stream-client";

export type { PlaybackProfile } from "@jedflix/shared";

export const {
  resolveStreamUrl,
  getPlaybackUrl,
  getExternalPlaybackUrl,
  fetchSources,
} = streamClient;
