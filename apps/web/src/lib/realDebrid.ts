import { isRDBlockedFilename } from "@/lib/rdBlocked";
import type { ResolveRequest, StreamResult, StreamSource } from "@/lib/streamApi";

const API_BASE = "https://api.real-debrid.com/rest/1.0";
const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024 * 1024;

export type RealDebridErrorCode =
  | "infringing_file"
  | "missing_token"
  | "timeout"
  | "no_video_file"
  | "size_limit"
  | "no_links";

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
  onProgress?: (progress: string) => void;
};

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
      torrentId = await client.addMagnet(source.magnet);
      cleanupTorrent = true;
    }

    options.onProgress?.("Selecting video file");
    let info = await client.getTorrentInfo(torrentId);
    const file =
      request.type === "tv" && request.season !== undefined && request.episode !== undefined
        ? pickEpisodeFile(info.files, request.season, request.episode)
        : pickLargestVideoFile(info.files);
    if (!file) {
      throw new RealDebridError("no_video_file", "No video file found in torrent.");
    }
    if (file.bytes > (options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES)) {
      throw new RealDebridError("size_limit", "Selected file exceeds size limit.");
    }

    await client.selectFiles(torrentId, [file.id]);

    options.onProgress?.("Waiting for Real Debrid stream");
    info = await client.waitReady(torrentId, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, info);
    if (!info.links?.length) {
      throw new RealDebridError("no_links", "Real Debrid returned no links.");
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
    const form = new URLSearchParams({ magnet });
    const payload = await this.postForm<{ id: string }>("/torrents/addMagnet", form);
    return payload.id;
  }

  async selectFiles(torrentId: string, fileIds: number[]): Promise<void> {
    const form = new URLSearchParams({
      files: fileIds.length ? fileIds.join(",") : "all",
    });
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
    if (!normalized) {
      return null;
    }
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
        throw new RealDebridError("timeout", "Real Debrid torrent timed out.");
      }
      if (!info) {
        info = await this.getTorrentInfo(torrentId);
      }

      if (info.status === "downloaded") {
        return info;
      }
      if (isTerminalStatus(info.status)) {
        throw new Error(`Real Debrid torrent failed: ${info.status}`);
      }

      info = undefined;
      await delay(POLL_INTERVAL_MS, this.signal);
    }
  }

  async unrestrictLink(link: string): Promise<UnrestrictResponse> {
    const form = new URLSearchParams({ link });
    return this.postForm<UnrestrictResponse>("/unrestrict/link", form);
  }

  private async getJSON<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async postForm<T = unknown>(path: string, form: URLSearchParams): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
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

function realDebridApiError(path: string, status: number, body: string): Error {
  const normalized = body.toLowerCase();
  if (
    status === 451 ||
    normalized.includes("infringing_file") ||
    normalized.includes('"error_code":35') ||
    normalized.includes('"error_code": 35')
  ) {
    return new RealDebridError("infringing_file", `Real Debrid rejected ${path}: ${body}`, status);
  }
  return new Error(`Real Debrid ${path} returned ${status}: ${body}`);
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
  if (!match) {
    return false;
  }
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
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Real Debrid resolve was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}
