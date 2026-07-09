import { isRDBlockedFilename } from "@jedflix/shared";
import type { ResolveRequest, StreamResult, StreamSource } from "@jedflix/stream-client";
import { normalizeMagnetForSource } from "@/lib/magnet";

const API_BASE = "https://api.real-debrid.com/rest/1.0";
const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024 * 1024;

export type RealDebridErrorCode =
  | "infringing_file"
  | "invalid_magnet"
  | "missing_token"
  | "timeout"
  | "no_video_file"
  | "size_limit"
  | "no_links"
  | "api_error";

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

type TorrentInfo = {
  id: string;
  status: string;
  hash?: string;
  files: TorrentFile[];
  links?: string[];
};

type TorrentListItem = {
  id: string;
  filename?: string;
  hash?: string;
  status?: string;
};

type TorrentFile = {
  id: number;
  path: string;
  bytes: number;
  selected?: number;
};

type UnrestrictResponse = {
  download: string;
  filename?: string;
  filesize?: number;
};

type ResolveOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxVideoBytes?: number;
  fileIdx?: number;
  onProgress?: (progress: string) => void;
};

type RealDebridApiErrorBody = {
  error?: string;
  error_code?: number;
};

export function formatRealDebridError(error: unknown): string {
  if (error instanceof RealDebridError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Stream resolution failed. Try another source.";
}

export function isRecoverableStreamError(error: unknown): boolean {
  if (!(error instanceof RealDebridError)) return true;
  return [
    "infringing_file",
    "invalid_magnet",
    "timeout",
    "no_video_file",
    "size_limit",
    "no_links",
    "api_error",
  ].includes(error.code);
}

export async function checkInstantAvailability(
  token: string,
  infoHashes: string[],
): Promise<Record<string, boolean>> {
  const trimmedToken = token.trim();
  if (!trimmedToken || infoHashes.length === 0) {
    return {};
  }

  const params = new URLSearchParams();
  for (const hash of infoHashes) {
    params.append("hash", hash.toLowerCase());
  }

  const response = await fetch(`${API_BASE}/torrents/instantAvailability?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${trimmedToken}`,
    },
  });

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const result: Record<string, boolean> = {};
  for (const hash of Object.keys(payload)) {
    result[hash.toLowerCase()] = true;
  }
  return result;
}

export async function resolveRealDebridStream(
  source: StreamSource,
  request: ResolveRequest,
  token: string,
  options: ResolveOptions = {},
): Promise<StreamResult> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new RealDebridError(
      "missing_token",
      "Real Debrid API key is required. Add it in Settings.",
    );
  }
  if (isRDBlockedFilename(source.title)) {
    throw new RealDebridError(
      "infringing_file",
      "Real Debrid often blocks this release type. Try another stream.",
    );
  }

  let magnet: string;
  try {
    magnet = normalizeMagnetForSource(source);
  } catch {
    throw new RealDebridError("invalid_magnet", "This torrent link is invalid. Try another stream.");
  }

  const client = new RealDebridClient(trimmedToken, options.signal);
  let torrentId = "";
  let cleanupTorrent = false;

  try {
    options.onProgress?.("Checking Real Debrid cache");
    if (source.infoHash) {
      const existing = await client.findByInfoHash(source.infoHash);
      if (existing) {
        if (existing.status === "downloaded") {
          torrentId = existing.id;
          cleanupTorrent = true;
        } else if (isTerminalStatus(existing.status)) {
          await client.deleteTorrent(existing.id).catch(() => undefined);
        }
      }
    }

    if (!torrentId) {
      options.onProgress?.("Adding magnet to Real Debrid");
      torrentId = await client.addMagnet(magnet);
      cleanupTorrent = true;
    }

    options.onProgress?.("Selecting video file");
    let info = await client.getTorrentInfo(torrentId);
    const file =
      request.type === "tv" && request.season !== undefined && request.episode !== undefined
        ? pickEpisodeFile(info.files, request.season, request.episode)
        : pickTorrentFile(info.files, options.fileIdx);
    if (!file) {
      throw new RealDebridError("no_video_file", "No playable video found in this torrent.");
    }
    if (file.bytes > (options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES)) {
      throw new RealDebridError("size_limit", "This file is too large. Try a smaller release.");
    }

    await client.selectFiles(torrentId, [file.id]);

    options.onProgress?.("Waiting for Real Debrid stream");
    info = await client.waitReady(torrentId, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, info);
    if (!info.links?.length) {
      throw new RealDebridError("no_links", "Real Debrid returned no download links.");
    }

    options.onProgress?.("Creating direct playback link");
    const unrestricted = await client.unrestrictLink(info.links[0]);
    return {
      url: unrestricted.download,
      directUrl: unrestricted.download,
      filename: unrestricted.filename,
      filesize: unrestricted.filesize,
      mode: "direct",
    };
  } finally {
    if (cleanupTorrent && torrentId) {
      await client.deleteTorrent(torrentId).catch(() => undefined);
    }
  }
}

class RealDebridClient {
  constructor(
    private token: string,
    private signal?: AbortSignal,
  ) {}

  async addMagnet(magnet: string): Promise<string> {
    const form = new URLSearchParams();
    form.set("magnet", magnet);
    const payload = await this.postForm<{ id: string }>("/torrents/addMagnet", form);
    return payload.id;
  }

  async selectFiles(torrentId: string, fileIds: number[]): Promise<void> {
    const form = new URLSearchParams();
    form.set("files", fileIds.length ? fileIds.join(",") : "all");
    await this.postForm(`/torrents/selectFiles/${torrentId}`, form);
  }

  async getTorrentInfo(torrentId: string): Promise<TorrentInfo> {
    return this.getJSON<TorrentInfo>(`/torrents/info/${torrentId}`);
  }

  async listTorrents(): Promise<TorrentListItem[]> {
    return this.getJSON<TorrentListItem[]>("/torrents");
  }

  async findByInfoHash(infoHash: string): Promise<TorrentListItem | null> {
    const normalized = infoHash.trim().toLowerCase();
    if (!normalized) return null;
    const torrents = await this.listTorrents();
    return torrents.find((torrent) => torrent.hash?.trim().toLowerCase() === normalized) ?? null;
  }

  async deleteTorrent(torrentId: string): Promise<void> {
    await this.request(`/torrents/delete/${torrentId}`, { method: "DELETE" });
  }

  async waitReady(torrentId: string, timeoutMs: number, initial?: TorrentInfo): Promise<TorrentInfo> {
    const deadline = Date.now() + timeoutMs;
    let info = initial;

    for (;;) {
      if (this.signal?.aborted) {
        throw new DOMException("Real Debrid resolve was cancelled.", "AbortError");
      }
      if (Date.now() > deadline) {
        throw new RealDebridError("timeout", "Real Debrid timed out. Try a cached stream.");
      }
      if (!info) {
        info = await this.getTorrentInfo(torrentId);
      }

      if (info.status === "downloaded") {
        return info;
      }
      if (isTerminalStatus(info.status)) {
        throw new RealDebridError(
          "api_error",
          `Real Debrid could not download this torrent (${info.status}). Try another stream.`,
        );
      }

      info = undefined;
      await delay(POLL_INTERVAL_MS, this.signal);
    }
  }

  async unrestrictLink(link: string): Promise<UnrestrictResponse> {
    const form = new URLSearchParams();
    form.set("link", link);
    return this.postForm<UnrestrictResponse>("/unrestrict/link", form);
  }

  private async getJSON<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async postForm<T = unknown>(path: string, form: URLSearchParams): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: this.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw realDebridApiError(path, response.status, text);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

function parseApiErrorBody(body: string): RealDebridApiErrorBody {
  try {
    return JSON.parse(body) as RealDebridApiErrorBody;
  } catch {
    return {};
  }
}

function realDebridApiError(path: string, status: number, body: string): RealDebridError {
  const parsed = parseApiErrorBody(body);
  const errorCode = parsed.error_code;
  const errorText = parsed.error?.toLowerCase() ?? body.toLowerCase();

  if (
    status === 451 ||
    errorCode === 35 ||
    errorText.includes("infringing_file") ||
    body.includes('"error_code":35') ||
    body.includes('"error_code": 35')
  ) {
    return new RealDebridError(
      "infringing_file",
      "Real Debrid blocked this release (copyright filter). Try another stream.",
      status,
    );
  }

  if (
    (errorText.includes("magnet") && errorText.includes("invalid")) ||
    parsed.error === "magnet_invalid"
  ) {
    return new RealDebridError(
      "invalid_magnet",
      "This torrent link is invalid. Try another stream.",
      status,
    );
  }

  if (status === 401 || errorCode === 8 || errorText.includes("bad_token")) {
    return new RealDebridError(
      "missing_token",
      "Real Debrid rejected your API key. Check Settings and try again.",
      status,
    );
  }

  if (status === 503 || errorText.includes("disabled") || errorText.includes("unavailable")) {
    return new RealDebridError(
      "api_error",
      "Real Debrid is temporarily unavailable. Try again shortly.",
      status,
    );
  }

  const shortDetail = parsed.error ?? body.slice(0, 120);
  return new RealDebridError(
    "api_error",
    `Real Debrid error${errorCode ? ` (${errorCode})` : ""}: ${shortDetail}`,
    status,
  );
}

function pickTorrentFile(files: TorrentFile[], fileIdx?: number): TorrentFile | null {
  if (fileIdx !== undefined && fileIdx >= 0 && fileIdx < files.length) {
    const indexed = files[fileIdx];
    if (indexed && isVideoFile(indexed.path)) {
      return indexed;
    }
  }
  return pickLargestVideoFile(files);
}

function pickLargestVideoFile(files: TorrentFile[]): TorrentFile | null {
  return files.filter((file) => isVideoFile(file.path)).sort((a, b) => b.bytes - a.bytes)[0] ?? null;
}

function pickEpisodeFile(files: TorrentFile[], season: number, episode: number): TorrentFile | null {
  const matching = files
    .filter((file) => isVideoFile(file.path) && matchesEpisode(file.path, season, episode))
    .sort((a, b) => b.bytes - a.bytes)[0];
  return matching ?? pickLargestVideoFile(files);
}

function matchesEpisode(path: string, season: number, episode: number): boolean {
  const filename = path.split("/").pop() ?? path;
  const match = /[Ss](\d{1,2})[Ee](\d{1,2})/.exec(filename);
  if (!match) return false;
  return Number(match[1]) === season && Number(match[2]) === episode;
}

function isVideoFile(path: string): boolean {
  return [".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts"].some((ext) =>
    path.toLowerCase().endsWith(ext),
  );
}

function isTerminalStatus(status?: string): boolean {
  return status === "error" || status === "magnet_error" || status === "virus" || status === "dead";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Real Debrid resolve was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}
