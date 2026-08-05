import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  MAX_LIKED_SONGS,
  musicTrackValidator,
  normalizeTrack,
  type MusicTrack,
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

async function getLikedCount(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const stats = await ctx.db
    .query("userMusicStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats) {
    return stats.likedCount;
  }
  // Legacy rows before stats existed: sample up to the cap once.
  const sample = await ctx.db
    .query("likedSongs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_LIKED_SONGS);
  return sample.length;
}

async function setLikedCount(
  ctx: MutationCtx,
  userId: Id<"users">,
  likedCount: number,
) {
  const stats = await ctx.db
    .query("userMusicStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const now = Date.now();
  if (stats) {
    await ctx.db.patch(stats._id, { likedCount, updatedAt: now });
  } else {
    await ctx.db.insert("userMusicStats", { userId, likedCount, updatedAt: now });
  }
}

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

/** Paginated liked songs for large libraries. Newest first via _creationTime. */
export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("likedSongs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((item) => ({
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
      })),
    };
  },
});

export const count = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return 0;
    }
    return await getLikedCount(ctx, userId);
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

    const likedCount = await getLikedCount(ctx, userId);
    if (likedCount >= MAX_LIKED_SONGS) {
      throw new Error(`Liked songs limit reached (${MAX_LIKED_SONGS})`);
    }

    await ctx.db.insert("likedSongs", {
      userId,
      ...track,
      addedAt: Date.now(),
    });
    await setLikedCount(ctx, userId, likedCount + 1);
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
      const likedCount = await getLikedCount(ctx, userId);
      await ctx.db.delete(existing._id);
      await setLikedCount(ctx, userId, Math.max(0, likedCount - 1));
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
      const likedCount = await getLikedCount(ctx, userId);
      await ctx.db.delete(existing._id);
      await setLikedCount(ctx, userId, Math.max(0, likedCount - 1));
      return { liked: false };
    }

    const likedCount = await getLikedCount(ctx, userId);
    if (likedCount >= MAX_LIKED_SONGS) {
      throw new Error(`Liked songs limit reached (${MAX_LIKED_SONGS})`);
    }

    await ctx.db.insert("likedSongs", {
      userId,
      ...track,
      addedAt: Date.now(),
    });
    await setLikedCount(ctx, userId, likedCount + 1);
    return { liked: true };
  },
});

/**
 * Bulk like for Spotify Liked Songs import. Dedupes and respects the cap.
 */
export const likeTracksBatch = internalMutation({
  args: {
    userId: v.id("users"),
    tracks: v.array(musicTrackValidator),
  },
  returns: v.object({
    added: v.number(),
    skipped: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    let likedCount = await getLikedCount(ctx, args.userId);
    let added = 0;
    let skipped = 0;
    let truncated = false;
    const now = Date.now();

    for (const raw of args.tracks) {
      if (likedCount >= MAX_LIKED_SONGS) {
        truncated = true;
        skipped += 1;
        continue;
      }

      let track: MusicTrack;
      try {
        track = normalizeTrack(raw);
      } catch {
        skipped += 1;
        continue;
      }

      const existing = await ctx.db
        .query("likedSongs")
        .withIndex("by_user_and_track", (q) =>
          q.eq("userId", args.userId).eq("id", track.id),
        )
        .unique();
      if (existing) {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("likedSongs", {
        userId: args.userId,
        ...track,
        addedAt: now,
      });
      likedCount += 1;
      added += 1;
    }

    if (added > 0) {
      await setLikedCount(ctx, args.userId, likedCount);
    }

    return { added, skipped, truncated };
  },
});
