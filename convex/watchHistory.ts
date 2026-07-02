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
      .collect();

    return await Promise.all(
      history.map(async (entry) => {
        const movie = await ctx.db.get(entry.movieId);
        return movie ? { ...entry, movie } : null;
      }),
    ).then((entries) => entries.filter((entry) => entry !== null));
  },
});

export const upsertProgress = mutation({
  args: {
    movieId: v.id("movies"),
    progressSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save watch progress");
    }

    const existing = await ctx.db
      .query("watchHistory")
      .withIndex("by_user_movie", (q) =>
        q.eq("userId", userId).eq("movieId", args.movieId),
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
      progressSeconds: args.progressSeconds,
      lastWatchedAt,
    });
  },
});
