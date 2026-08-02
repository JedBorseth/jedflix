import type { StreamSource } from "@/lib/streamApi";

export type SavedStreamPreference = {
  streamAbbPostUrl?: string;
  streamMagnet?: string;
  streamInfoHash?: string;
  streamTitle?: string;
};

export function hasSavedStream(saved?: SavedStreamPreference | null): boolean {
  if (!saved) {
    return false;
  }
  return Boolean(
    saved.streamAbbPostUrl?.trim() ||
      saved.streamMagnet?.trim() ||
      saved.streamInfoHash?.trim(),
  );
}

export function matchSavedStream(
  sources: StreamSource[],
  saved?: SavedStreamPreference | null,
): StreamSource | null {
  if (!hasSavedStream(saved)) {
    return null;
  }
  const abb = saved!.streamAbbPostUrl?.trim();
  const hash = saved!.streamInfoHash?.trim().toLowerCase();
  const magnet = saved!.streamMagnet?.trim();

  const fromList =
    sources.find((source) => abb && source.abbPostUrl === abb) ??
    sources.find((source) => hash && source.infoHash?.toLowerCase() === hash) ??
    sources.find((source) => magnet && source.magnet && source.magnet === magnet) ??
    null;

  if (fromList) {
    return fromList;
  }

  // Reconstruct even if ABB ranking no longer includes this post.
  return {
    id: "saved-stream",
    title: saved!.streamTitle?.trim() || "Saved source",
    magnet: magnet ?? "",
    infoHash: hash,
    abbPostUrl: abb,
  };
}

export function streamPreferenceFromSource(source: StreamSource): SavedStreamPreference {
  return {
    streamAbbPostUrl: source.abbPostUrl,
    streamMagnet: source.magnet || undefined,
    streamInfoHash: source.infoHash,
    streamTitle: source.title,
  };
}
