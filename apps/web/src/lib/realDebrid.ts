import { isRDBlockedFilename } from "@/lib/rdBlocked";
import {
  resolveStream as resolveStreamViaApi,
  type ResolveRequest,
  type StreamResult,
  type StreamSource,
} from "@/lib/streamApi";
import { StreamResolveError } from "@jedflix/stream-client";

export type RealDebridErrorCode =
  | "infringing_file"
  | "missing_token"
  | "timeout"
  | "no_video_file"
  | "title_mismatch"
  | "size_limit"
  | "no_links"
  | "rate_limited"
  | "cancelled"
  | "invalid_request";

export class RealDebridError extends Error {
  code: RealDebridErrorCode;
  status?: number;

  constructor(code: RealDebridErrorCode, message: string, status?: number) {
    super(message);
    this.name = "RealDebridError";
    this.code = code;
    this.status = status;
  }
}

type ResolveOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: string) => void;
};

/**
 * Resolves a magnet to a direct Real Debrid CDN URL via the stream-server.
 * RD API calls happen server-side (avoids browser CORS); video bytes stay direct.
 */
export async function resolveRealDebridStream(
  source: StreamSource,
  request: ResolveRequest,
  token: string,
  options: ResolveOptions = {},
): Promise<StreamResult> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new RealDebridError("missing_token", "Real Debrid API key is required for direct streaming.");
  }
  if (isRDBlockedFilename(source.title)) {
    throw new RealDebridError("infringing_file", "This release matches Real Debrid's infringing-file filter.");
  }

  options.onProgress?.("Resolving with Real Debrid");

  try {
    return await resolveStreamViaApi(
      source,
      {
        ...request,
        realDebridToken: trimmedToken,
      },
      { signal: options.signal },
    );
  } catch (error) {
    if (options.signal?.aborted) {
      throw new DOMException("Real Debrid resolve was cancelled.", "AbortError");
    }
    if (error instanceof StreamResolveError) {
      throw new RealDebridError(normalizeErrorCode(error.code), error.message, error.status);
    }
    throw error;
  }
}

function normalizeErrorCode(code: string): RealDebridErrorCode {
  switch (code) {
    case "infringing_file":
    case "missing_token":
    case "timeout":
    case "no_video_file":
    case "title_mismatch":
    case "size_limit":
    case "no_links":
    case "rate_limited":
    case "cancelled":
    case "invalid_request":
      return code;
    case "abb_magnet":
      return "invalid_request";
    default:
      return "no_links";
  }
}
