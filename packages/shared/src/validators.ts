import { v } from "convex/values";

export const mediaTypeValidator = v.union(
  v.literal("movie"),
  v.literal("tv"),
  v.literal("audiobook"),
  v.literal("ebook"),
);

export const bookFormatValidator = v.union(v.literal("audiobook"), v.literal("ebook"));

/** @deprecated Playback is direct-only; kept for existing Convex userSettings docs. */
export const streamModeValidator = v.union(v.literal("direct"), v.literal("proxy"));

export const externalPlayerValidator = v.union(
  v.literal("disabled"),
  v.literal("vlc"),
  v.literal("outplayer"),
);

export const playbackProfileValidator = v.union(
  v.literal("browser"),
  v.literal("external"),
);
