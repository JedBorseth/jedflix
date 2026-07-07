import { v } from "convex/values";

export const mediaTypeValidator = v.union(v.literal("movie"), v.literal("tv"));

export const streamModeValidator = v.union(v.literal("direct"), v.literal("proxy"));

export const externalPlayerValidator = v.union(
  v.literal("disabled"),
  v.literal("vlc"),
  v.literal("outplayer"),
);
