import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const mediaTypeValidator = v.union(v.literal("movie"), v.literal("tv"));

export const getForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const items = await ctx.db
      .query("myList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    return items.sort((a, b) => b.addedAt - a.addedAt);
  },
});

export const isSaved = query({
  args: {
    movieId: v.number(),
    mediaType: mediaTypeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return false;
    }

    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", args.movieId),
      )
      .unique();

    return existing !== null;
  },
});

export const toggle = mutation({
  args: {
    movieId: v.number(),
    mediaType: mediaTypeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to update My List");
    }

    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", args.movieId),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { saved: false };
    }

    await ctx.db.insert("myList", {
      userId,
      movieId: args.movieId,
      mediaType: args.mediaType,
      addedAt: Date.now(),
    });
    return { saved: true };
  },
});
