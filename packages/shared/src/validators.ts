import { v } from "convex/values";

export const mediaTypeValidator = v.union(v.literal("movie"), v.literal("tv"));

export const externalPlayerValidator = v.union(
  v.literal("disabled"),
  v.literal("vlc"),
  v.literal("outplayer"),
);

export const playbackProfileValidator = v.union(
  v.literal("browser"),
  v.literal("external"),
);
