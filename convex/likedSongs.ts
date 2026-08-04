import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  MAX_LIKED_SONGS,
  musicTrackValidator,
  normalizeTrack,
} from "./musicTrack";

const likedSongReturnValidator = v.object({
  _id: v.id("likedSongs"),
  id: v.string(),
  title: v.string(),
  artists: v.array(v.string()),
  artistIds: v.optional(v.array(v.string())),
  albumName: v.string(),
  albumId: v.optional(v.string()),
  imageUrl: v.string(),
  durationMs: v.number(),
  addedAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(likedSongReturnValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const items = await ctx.db
      .query("likedSongs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_LIKED_SONGS);

    return items
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((item) => ({
        _id: item._id,
        id: item.id,
        title: item.title,
        artists: item.artists,
        artistIds: item.artistIds,
        albumName: item.albumName,
        albumId: item.albumId,
        imageUrl: item.imageUrl,
        durationMs: item.durationMs,
        addedAt: item.addedAt,
      }));
  },
});

export const isLiked = query({
  args: { trackId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return false;
    }

    const trackId = args.trackId.trim();
    if (!trackId) {
      return false;
    }

    const existing = await ctx.db
      .query("likedSongs")
      .withIndex("by_user_and_track", (q) =>
        q.eq("userId", userId).eq("id", trackId),
      )
      .unique();

    return existing !== null;
  },
});

export const like = mutation({
  args: { track: musicTrackValidator },
  returns: v.object({ liked: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to like songs");
    }

    const track = normalizeTrack(args.track);
    const existing = await ctx.db
      .query("likedSongs")
      .withIndex("by_user_and_track", (q) =>
        q.eq("userId", userId).eq("id", track.id),
      )
      .unique();

    if (existing) {
      return { liked: true };
    }

    const count = (
      await ctx.db
        .query("likedSongs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_LIKED_SONGS + 1)
    ).length;
    if (count >= MAX_LIKED_SONGS) {
      throw new Error(`Liked songs limit reached (${MAX_LIKED_SONGS})`);
    }

    await ctx.db.insert("likedSongs", {
      userId,
      ...track,
      addedAt: Date.now(),
    });
    return { liked: true };
  },
});

export const unlike = mutation({
  args: { trackId: v.string() },
  returns: v.object({ liked: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to unlike songs");
    }

    const trackId = args.trackId.trim();
    if (!trackId) {
      throw new Error("Track id is required");
    }

    const existing = await ctx.db
      .query("likedSongs")
      .withIndex("by_user_and_track", (q) =>
        q.eq("userId", userId).eq("id", trackId),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { liked: false };
  },
});

export const toggle = mutation({
  args: { track: musicTrackValidator },
  returns: v.object({ liked: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to like songs");
    }

    const track = normalizeTrack(args.track);
    const existing = await ctx.db
      .query("likedSongs")
      .withIndex("by_user_and_track", (q) =>
        q.eq("userId", userId).eq("id", track.id),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { liked: false };
    }

    const count = (
      await ctx.db
        .query("likedSongs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(MAX_LIKED_SONGS + 1)
    ).length;
    if (count >= MAX_LIKED_SONGS) {
      throw new Error(`Liked songs limit reached (${MAX_LIKED_SONGS})`);
    }

    await ctx.db.insert("likedSongs", {
      userId,
      ...track,
      addedAt: Date.now(),
    });
    return { liked: true };
  },
});
