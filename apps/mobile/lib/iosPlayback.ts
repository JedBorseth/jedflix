import {
  DIRECT_PLAYBACK_HINT,
  filterDirectPlaybackSources,
  isDirectPlaybackIncompatible,
  scoreDirectPlaybackCompatibility,
  sortDirectPlaybackSources,
} from "@jedflix/shared";
import { Platform } from "react-native";
import type { StreamSource } from "@jedflix/stream-client";

export function isIosDevice(): boolean {
  return Platform.OS === "ios";
}

export function sortSourcesForMobilePlayback(sources: StreamSource[]): StreamSource[] {
  return sortDirectPlaybackSources(filterDirectPlaybackSources(sources));
}

export const IOS_PLAYBACK_HINT = DIRECT_PLAYBACK_HINT;

export function isLikelyIosIncompatible(filename?: string, title?: string): boolean {
  return isDirectPlaybackIncompatible(`${filename ?? ""} ${title ?? ""}`);
}

export { scoreDirectPlaybackCompatibility };
