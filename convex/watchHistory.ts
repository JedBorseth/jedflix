import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const history = await ctx.db
      .query("watchHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);

    return history.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
  },
});

export const upsertProgress = mutation({
  args: {
    movieId: v.number(),
    mediaType: v.union(v.literal("movie"), v.literal("tv")),
    progressSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save watch progress");
    }

    const existing = await ctx.db
      .query("watchHistory")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", args.movieId),
      )
      .unique();

    const lastWatchedAt = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        progressSeconds: args.progressSeconds,
        lastWatchedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("watchHistory", {
      userId,
      movieId: args.movieId,
      mediaType: args.mediaType,
      progressSeconds: args.progressSeconds,
      lastWatchedAt,
    });
  },
});
