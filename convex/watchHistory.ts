import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { isBookMediaType, mediaTypeValidator } from "@jedflix/shared";
import { mutation, query } from "./_generated/server";
import { assertMediaIdentity } from "./mediaIdentity";
import schema from "./schema";

const selectedStreamArgs = {
  selectedStreamId: v.optional(v.string()),
  selectedStreamTitle: v.optional(v.string()),
  selectedStreamMagnet: v.optional(v.string()),
  selectedStreamAbbPostUrl: v.optional(v.string()),
  selectedStreamInfoHash: v.optional(v.string()),
};

export const getForUser = query({
  args: {},
  returns: v.array(schema.doc("watchHistory")),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    return await ctx.db
      .query("watchHistory")
      .withIndex("by_user_and_lastWatchedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
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
    ...selectedStreamArgs,
  },
  returns: v.id("watchHistory"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save watch progress");
    }

    assertMediaIdentity(args);

    const lastWatchedAt = Date.now();
    const patch = {
      progressSeconds: args.progressSeconds,
      lastWatchedAt,
      season: args.season,
      episode: args.episode,
      fileIndex: args.fileIndex,
      location: args.location,
      ...(args.selectedStreamId !== undefined
        ? {
            selectedStreamId: args.selectedStreamId,
            selectedStreamTitle: args.selectedStreamTitle,
            selectedStreamMagnet: args.selectedStreamMagnet,
            selectedStreamAbbPostUrl: args.selectedStreamAbbPostUrl,
            selectedStreamInfoHash: args.selectedStreamInfoHash,
          }
        : {}),
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
        selectedStreamId: args.selectedStreamId,
        selectedStreamTitle: args.selectedStreamTitle,
        selectedStreamMagnet: args.selectedStreamMagnet,
        selectedStreamAbbPostUrl: args.selectedStreamAbbPostUrl,
        selectedStreamInfoHash: args.selectedStreamInfoHash,
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
    });
  },
});

/** Mark an audiobook as recently opened without requiring playback progress. */
export const touchAudiobookRecent = mutation({
  args: {
    workId: v.string(),
  },
  returns: v.id("watchHistory"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save recent audiobooks");
    }

    const workId = args.workId.trim();
    if (!workId) {
      throw new Error("workId is required");
    }

    const lastWatchedAt = Date.now();
    const existing = await ctx.db
      .query("watchHistory")
      .withIndex("by_user_and_media_type_and_work_id", (q) =>
        q.eq("userId", userId).eq("mediaType", "audiobook").eq("workId", workId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { lastWatchedAt });
      return existing._id;
    }

    return await ctx.db.insert("watchHistory", {
      userId,
      workId,
      mediaType: "audiobook",
      progressSeconds: 0,
      lastWatchedAt,
    });
  },
});

/** Persist the stream the user picked for one-click listen later. */
export const saveAudiobookStream = mutation({
  args: {
    workId: v.string(),
    selectedStreamId: v.string(),
    selectedStreamTitle: v.string(),
    selectedStreamMagnet: v.optional(v.string()),
    selectedStreamAbbPostUrl: v.optional(v.string()),
    selectedStreamInfoHash: v.optional(v.string()),
  },
  returns: v.id("watchHistory"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save audiobook streams");
    }

    const workId = args.workId.trim();
    if (!workId) {
      throw new Error("workId is required");
    }

    const lastWatchedAt = Date.now();
    const streamPatch = {
      lastWatchedAt,
      selectedStreamId: args.selectedStreamId,
      selectedStreamTitle: args.selectedStreamTitle,
      selectedStreamMagnet: args.selectedStreamMagnet,
      selectedStreamAbbPostUrl: args.selectedStreamAbbPostUrl,
      selectedStreamInfoHash: args.selectedStreamInfoHash,
    };

    const existing = await ctx.db
      .query("watchHistory")
      .withIndex("by_user_and_media_type_and_work_id", (q) =>
        q.eq("userId", userId).eq("mediaType", "audiobook").eq("workId", workId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, streamPatch);
      return existing._id;
    }

    return await ctx.db.insert("watchHistory", {
      userId,
      workId,
      mediaType: "audiobook",
      progressSeconds: 0,
      ...streamPatch,
    });
  },
});
