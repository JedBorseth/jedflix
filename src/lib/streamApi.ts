import { authenticatedFetch } from "@/lib/authenticatedFetch";

export type StreamMode = "direct" | "proxy";

export type SourcesRequest = {
  type: "movie" | "tv";
  imdbId: string;
  season?: number;
  episode?: number;
};

export type ResolveRequest = SourcesRequest & {
  mode: StreamMode;
  magnet?: string;
  infoHash?: string;
  realDebridToken?: string;
};

export type StreamSource = {
  id: string;
  title: string;
  magnet: string;
  infoHash?: string;
  sizeGb?: number;
  seeders?: number;
  cached?: boolean;
};

export type StreamResult = {
  url: string;
  directUrl?: string;
  filename?: string;
  filesize?: number;
  mode: StreamMode;
};

export type ResolveJob = {
  jobId: string;
  status: "searching" | "downloading" | "ready" | "failed";
  progress?: string;
  error?: string;
  errorCode?: string;
  sources?: StreamSource[];
  stream?: StreamResult;
};

const API_BASE = import.meta.env.VITE_STREAM_API_URL ?? "/stream-api";
const API_KEY = import.meta.env.VITE_STREAM_API_KEY;

function headers(realDebridToken?: string): HeadersInit {
  const result: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    result["X-Api-Key"] = API_KEY;
  }
  if (realDebridToken) {
    result.Authorization = `Bearer ${realDebridToken}`;
  }
  return result;
}

export function resolveStreamUrl(relativeOrAbsolute: string): string {
  if (relativeOrAbsolute.startsWith("http://") || relativeOrAbsolute.startsWith("https://")) {
    return relativeOrAbsolute;
  }
  const base = API_BASE.replace(/\/$/, "");
  if (relativeOrAbsolute.startsWith(`${base}/`) || relativeOrAbsolute === base) {
    return relativeOrAbsolute;
  }
  return `${base}${relativeOrAbsolute.startsWith("/") ? "" : "/"}${relativeOrAbsolute}`;
}

/** Direct mode plays from Real Debrid CDN; proxy mode uses the Go byte-serving proxy. */
export function getPlaybackUrl(stream: StreamResult): string {
  if (stream.mode === "direct") {
    return stream.directUrl ?? stream.url;
  }
  return resolveStreamUrl(stream.url);
}

/** External players should use the Real Debrid CDN URL so they can play any codec and avoid app auth on the proxy. */
export function getExternalPlaybackUrl(stream: StreamResult): string {
  return stream.directUrl ?? getPlaybackUrl(stream);
}

export async function fetchSources(
  request: SourcesRequest,
  realDebridToken?: string,
): Promise<StreamSource[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/v1/sources`, {
    method: "POST",
    headers: headers(realDebridToken),
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Source search failed (${response.status})`);
  }
  const payload = (await response.json()) as { sources: StreamSource[] };
  return payload.sources;
}

export async function startResolve(request: ResolveRequest, realDebridToken?: string): Promise<ResolveJob> {
  const { realDebridToken: _realDebridToken, ...body } = request;
  const response = await authenticatedFetch(`${API_BASE}/api/v1/resolve`, {
    method: "POST",
    headers: headers(realDebridToken ?? request.realDebridToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Resolve failed (${response.status})`);
  }
  return (await response.json()) as ResolveJob;
}

export async function pollResolve(jobId: string): Promise<ResolveJob> {
  const response = await authenticatedFetch(`${API_BASE}/api/v1/resolve/${jobId}`, {
    headers: headers(),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Resolve poll failed (${response.status})`);
  }
  return (await response.json()) as ResolveJob;
}
