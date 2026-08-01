import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { isBookMediaType, isVideoMediaType, mediaTypeValidator } from "@jedflix/shared";
import { mutation, query } from "./_generated/server";

function assertMediaIdentity(args: {
  mediaType: "movie" | "tv" | "audiobook" | "ebook";
  movieId?: number;
  workId?: string;
}) {
  if (isVideoMediaType(args.mediaType)) {
    if (args.movieId === undefined) {
      throw new Error("movieId is required for movie/tv");
    }
    return;
  }
  if (isBookMediaType(args.mediaType)) {
    if (!args.workId?.trim()) {
      throw new Error("workId is required for audiobook/ebook");
    }
  }
}

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
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return false;
    }

    assertMediaIdentity(args);

    if (isBookMediaType(args.mediaType)) {
      const workId = args.workId!.trim();
      const existing = await ctx.db
        .query("myList")
        .withIndex("by_user_and_media_type_and_work_id", (q) =>
          q.eq("userId", userId).eq("mediaType", args.mediaType).eq("workId", workId),
        )
        .unique();
      return existing !== null;
    }

    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", args.movieId!),
      )
      .unique();

    return existing !== null;
  },
});

export const toggle = mutation({
  args: {
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to update My List");
    }

    assertMediaIdentity(args);

    if (isBookMediaType(args.mediaType)) {
      const workId = args.workId!.trim();
      const existing = await ctx.db
        .query("myList")
        .withIndex("by_user_and_media_type_and_work_id", (q) =>
          q.eq("userId", userId).eq("mediaType", args.mediaType).eq("workId", workId),
        )
        .unique();

      if (existing) {
        await ctx.db.delete(existing._id);
        return { saved: false };
      }

      await ctx.db.insert("myList", {
        userId,
        workId,
        mediaType: args.mediaType,
        addedAt: Date.now(),
      });
      return { saved: true };
    }

    const movieId = args.movieId!;
    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", movieId),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { saved: false };
    }

    await ctx.db.insert("myList", {
      userId,
      movieId,
      mediaType: args.mediaType,
      addedAt: Date.now(),
    });
    return { saved: true };
  },
});
