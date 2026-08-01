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

export const getForMedia = query({
  args: {
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertMediaIdentity(args);

    const reviews = isBookMediaType(args.mediaType)
      ? await ctx.db
          .query("mediaReviews")
          .withIndex("by_media_type_and_work_id", (q) =>
            q.eq("mediaType", args.mediaType).eq("workId", args.workId!.trim()),
          )
          .order("desc")
          .take(50)
      : await ctx.db
          .query("mediaReviews")
          .withIndex("by_media_type_and_movie_id", (q) =>
            q.eq("mediaType", args.mediaType).eq("movieId", args.movieId!),
          )
          .order("desc")
          .take(50);

    return Promise.all(
      reviews.map(async (review) => {
        const user = await ctx.db.get(review.userId);
        return {
          _id: review._id,
          rating: review.rating,
          comment: review.comment,
          updatedAt: review.updatedAt,
          userName: user?.name ?? user?.email ?? "Viewer",
          userImage: user?.image ?? null,
        };
      }),
    );
  },
});

export const getSummary = query({
  args: {
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertMediaIdentity(args);

    const reviews = isBookMediaType(args.mediaType)
      ? await ctx.db
          .query("mediaReviews")
          .withIndex("by_media_type_and_work_id", (q) =>
            q.eq("mediaType", args.mediaType).eq("workId", args.workId!.trim()),
          )
          .take(200)
      : await ctx.db
          .query("mediaReviews")
          .withIndex("by_media_type_and_movie_id", (q) =>
            q.eq("mediaType", args.mediaType).eq("movieId", args.movieId!),
          )
          .take(200);

    if (reviews.length === 0) {
      return { averageRating: 0, reviewCount: 0 };
    }

    const total = reviews.reduce((sum, review) => sum + review.rating, 0);
    return {
      averageRating: Math.round((total / reviews.length) * 10) / 10,
      reviewCount: reviews.length,
    };
  },
});

export const getViewerReview = query({
  args: {
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    assertMediaIdentity(args);

    if (isBookMediaType(args.mediaType)) {
      return await ctx.db
        .query("mediaReviews")
        .withIndex("by_user_and_media_type_and_work_id", (q) =>
          q
            .eq("userId", userId)
            .eq("mediaType", args.mediaType)
            .eq("workId", args.workId!.trim()),
        )
        .unique();
    }

    return await ctx.db
      .query("mediaReviews")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", args.movieId!),
      )
      .unique();
  },
});

export const submit = mutation({
  args: {
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
    rating: v.number(),
    comment: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to leave a review");
    }

    assertMediaIdentity(args);

    if (args.rating < 1 || args.rating > 5) {
      throw new Error("Rating must be between 1 and 5 stars");
    }

    const comment = args.comment.trim();
    if (comment.length === 0) {
      throw new Error("Comment cannot be empty");
    }
    if (comment.length > 1000) {
      throw new Error("Comment is too long");
    }

    const updatedAt = Date.now();

    if (isBookMediaType(args.mediaType)) {
      const workId = args.workId!.trim();
      const existing = await ctx.db
        .query("mediaReviews")
        .withIndex("by_user_and_media_type_and_work_id", (q) =>
          q.eq("userId", userId).eq("mediaType", args.mediaType).eq("workId", workId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          rating: args.rating,
          comment,
          updatedAt,
        });
        return existing._id;
      }

      return await ctx.db.insert("mediaReviews", {
        userId,
        workId,
        mediaType: args.mediaType,
        rating: args.rating,
        comment,
        updatedAt,
      });
    }

    const movieId = args.movieId!;
    const existing = await ctx.db
      .query("mediaReviews")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", movieId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        comment,
        updatedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("mediaReviews", {
      userId,
      movieId,
      mediaType: args.mediaType,
      rating: args.rating,
      comment,
      updatedAt,
    });
  },
});
