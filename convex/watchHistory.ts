import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mediaTypeValidator } from "@jedflix/shared";
import { isBookMediaType, isVideoMediaType } from "@jedflix/shared";
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

const streamSourceArgs = {
  streamAbbPostUrl: v.optional(v.string()),
  streamMagnet: v.optional(v.string()),
  streamInfoHash: v.optional(v.string()),
  streamTitle: v.optional(v.string()),
};

function streamPatch(args: {
  streamAbbPostUrl?: string;
  streamMagnet?: string;
  streamInfoHash?: string;
  streamTitle?: string;
}) {
  const patch: {
    streamAbbPostUrl?: string;
    streamMagnet?: string;
    streamInfoHash?: string;
    streamTitle?: string;
  } = {};
  if (args.streamAbbPostUrl !== undefined) {
    patch.streamAbbPostUrl = args.streamAbbPostUrl.trim() || undefined;
  }
  if (args.streamMagnet !== undefined) {
    patch.streamMagnet = args.streamMagnet.trim() || undefined;
  }
  if (args.streamInfoHash !== undefined) {
    patch.streamInfoHash = args.streamInfoHash.trim().toLowerCase() || undefined;
  }
  if (args.streamTitle !== undefined) {
    patch.streamTitle = args.streamTitle.trim() || undefined;
  }
  return patch;
}

export const getForUser = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("watchHistory"),
      _creationTime: v.number(),
      userId: v.id("users"),
      movieId: v.optional(v.number()),
      workId: v.optional(v.string()),
      mediaType: mediaTypeValidator,
      progressSeconds: v.number(),
      lastWatchedAt: v.number(),
      season: v.optional(v.number()),
      episode: v.optional(v.number()),
      fileIndex: v.optional(v.number()),
      location: v.optional(v.string()),
      streamAbbPostUrl: v.optional(v.string()),
      streamMagnet: v.optional(v.string()),
      streamInfoHash: v.optional(v.string()),
      streamTitle: v.optional(v.string()),
    }),
  ),
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
    mediaType: mediaTypeValidator,
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
    progressSeconds: v.number(),
    season: v.optional(v.number()),
    episode: v.optional(v.number()),
    fileIndex: v.optional(v.number()),
    location: v.optional(v.string()),
    ...streamSourceArgs,
  },
  returns: v.id("watchHistory"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save watch progress");
    }

    assertMediaIdentity(args);

    const lastWatchedAt = Date.now();
    const stream = streamPatch(args);
    const patch = {
      progressSeconds: args.progressSeconds,
      lastWatchedAt,
      season: args.season,
      episode: args.episode,
      fileIndex: args.fileIndex,
      location: args.location,
      ...stream,
    };

    if (isBookMediaType(args.mediaType)) {
      const workId = args.workId!.trim();
      const existing = await ctx.db
        .query("watchHistory")
        .withIndex("by_user_and_media_type_and_work_id", (q) =>
          q.eq("userId", userId).eq("mediaType", args.mediaType).eq("workId", workId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return existing._id;
      }

      return await ctx.db.insert("watchHistory", {
        userId,
        workId,
        mediaType: args.mediaType,
        progressSeconds: args.progressSeconds,
        lastWatchedAt,
        season: args.season,
        episode: args.episode,
        fileIndex: args.fileIndex,
        location: args.location,
        ...stream,
      });
    }

    const movieId = args.movieId!;
    const existing = await ctx.db
      .query("watchHistory")
      .withIndex("by_user_and_media_type_and_movie_id", (q) =>
        q.eq("userId", userId).eq("mediaType", args.mediaType).eq("movieId", movieId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("watchHistory", {
      userId,
      movieId,
      mediaType: args.mediaType,
      progressSeconds: args.progressSeconds,
      lastWatchedAt,
      season: args.season,
      episode: args.episode,
      fileIndex: args.fileIndex,
      location: args.location,
      ...stream,
    });
  },
});
