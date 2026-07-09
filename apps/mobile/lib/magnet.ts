import type { StreamSource } from "@jedflix/stream-client";

const HEX_INFO_HASH = /^[a-f0-9]{40}$/i;
const BASE32_INFO_HASH = /^[a-z2-7]{32}$/i;

export function extractInfoHash(magnet: string, infoHash?: string): string | undefined {
  const fromField = infoHash?.trim().toLowerCase();
  if (fromField && (HEX_INFO_HASH.test(fromField) || BASE32_INFO_HASH.test(fromField))) {
    return fromField;
  }

  const trimmedMagnet = magnet.trim();
  if (!trimmedMagnet.startsWith("magnet:")) return undefined;

  const hexMatch = /btih:([a-f0-9]{40})/i.exec(trimmedMagnet);
  if (hexMatch?.[1]) return hexMatch[1].toLowerCase();

  const base32Match = /btih:([a-z2-7]{32})/i.exec(trimmedMagnet);
  if (base32Match?.[1]) return base32Match[1].toLowerCase();

  return undefined;
}

export function buildMagnetLink(infoHash: string): string {
  const normalized = infoHash.trim().toLowerCase();
  if (!HEX_INFO_HASH.test(normalized) && !BASE32_INFO_HASH.test(normalized)) {
    throw new Error("Invalid torrent info hash");
  }
  return `magnet:?xt=urn:btih:${normalized}`;
}

/** Real Debrid only accepts well-formed magnet links — always build from the info hash. */
export function normalizeMagnetForSource(source: Pick<StreamSource, "magnet" | "infoHash">): string {
  const hash = extractInfoHash(source.magnet, source.infoHash);
  if (!hash) {
    throw new Error("Invalid torrent link");
  }
  return buildMagnetLink(hash);
}

export function isValidStreamSource(source: Pick<StreamSource, "magnet" | "infoHash">): boolean {
  try {
    normalizeMagnetForSource(source);
    return true;
  } catch {
    return false;
  }
}
