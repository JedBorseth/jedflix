import type { StreamSource } from "@jedflix/stream-client";
import type { MediaType } from "@jedflix/shared";
import { isRDBlockedFilename } from "@jedflix/shared";
import { buildMagnetLink, extractInfoHash, isValidStreamSource } from "@/lib/magnet";

const TORRENTIO_BASE = "https://torrentio.strem.fun";

type TorrentioStream = {
  name?: string;
  title?: string;
  url?: string;
  infoHash?: string;
  description?: string;
  fileIdx?: number;
};

type TorrentioResponse = {
  streams?: TorrentioStream[];
};

export type MobileStreamSource = StreamSource & {
  fileIdx?: number;
};

export type TorrentioRequest = {
  type: MediaType;
  imdbId: string;
  season?: number;
  episode?: number;
};

function normalizeImdbId(imdbId: string): string {
  const trimmed = imdbId.trim().replace(/^tt/i, "");
  return `tt${trimmed}`;
}

function parseSizeGb(text: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith("G")) return value;
  return value / 1024;
}

function parseSeeders(text: string): number | undefined {
  const match = /👤\s*(\d+)|(\d+)\s*seeders?/i.exec(text);
  if (!match) return undefined;
  return Number(match[1] ?? match[2]);
}

function normalizeStream(stream: TorrentioStream, index: number): MobileStreamSource | null {
  const label = stream.title?.trim() || stream.name?.trim() || "Unknown release";
  if (isRDBlockedFilename(label)) return null;

  const description = stream.description?.trim() ?? "";
  const combined = `${label} ${description}`;

  const infoHash = extractInfoHash(stream.url?.trim() ?? "", stream.infoHash);
  if (!infoHash) return null;

  let magnet = stream.url?.trim() ?? "";
  if (!magnet.startsWith("magnet:")) {
    magnet = buildMagnetLink(infoHash);
  }

  const fileIdx = typeof stream.fileIdx === "number" ? stream.fileIdx : 0;
  const candidate: MobileStreamSource = {
    id: `${infoHash}:${fileIdx}`,
    title: label,
    magnet,
    infoHash,
    sizeGb: parseSizeGb(combined),
    seeders: parseSeeders(combined),
    cached: false,
    fileIdx,
  };

  return isValidStreamSource(candidate) ? candidate : null;
}

function assignUniqueIds(sources: MobileStreamSource[]): MobileStreamSource[] {
  return sources.map((source, index) => ({
    ...source,
    id: `${source.infoHash ?? "unknown"}:${source.fileIdx ?? 0}:${index}`,
  }));
}

function dedupeSources(sources: MobileStreamSource[]): MobileStreamSource[] {
  const bestByKey = new Map<string, MobileStreamSource>();
  for (const source of sources) {
    const dedupeKey = `${source.infoHash}:${source.fileIdx ?? 0}`;
    const existing = bestByKey.get(dedupeKey);
    if (!existing || (source.seeders ?? 0) > (existing.seeders ?? 0)) {
      bestByKey.set(dedupeKey, source);
    }
  }
  return assignUniqueIds(Array.from(bestByKey.values()));
}

export async function fetchTorrentioSources(request: TorrentioRequest): Promise<MobileStreamSource[]> {
  const imdbId = normalizeImdbId(request.imdbId);
  const endpoint =
    request.type === "tv"
      ? `${TORRENTIO_BASE}/stream/series/${imdbId}:${request.season}:${request.episode}.json`
      : `${TORRENTIO_BASE}/stream/movie/${imdbId}.json`;

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "JedFlix-Mobile/1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Torrentio returned ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }

  const payload = (await response.json()) as TorrentioResponse;
  const sources = dedupeSources(
    (payload.streams ?? [])
      .map((stream, index) => normalizeStream(stream, index))
      .filter((source): source is MobileStreamSource => source !== null),
  );

  if (sources.length === 0) {
    throw new Error("No streams found for this title");
  }

  return sources.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));
}
