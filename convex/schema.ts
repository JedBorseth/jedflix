import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  externalPlayerValidator,
  mediaTypeValidator,
  streamModeValidator,
} from "@jedflix/shared";

export default defineSchema({
  ...authTables,
  watchHistory: defineTable({
    userId: v.id("users"),
    // TMDB numeric id for movie/tv. Optional so audiobook/ebook rows can omit it.
    movieId: v.optional(v.number()),
    // Open Library work id for audiobook/ebook (e.g. OL82563W).
    workId: v.optional(v.string()),
    mediaType: mediaTypeValidator,
    progressSeconds: v.number(),
    lastWatchedAt: v.number(),
    season: v.optional(v.number()),
    episode: v.optional(v.number()),
    // Audiobook multi-file playlist index (0-based).
    fileIndex: v.optional(v.number()),
    // Ebook location: EPUB CFI or PDF page number as string.
    location: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"])
    .index("by_user_and_media_type_and_work_id", ["userId", "mediaType", "workId"]),
  myList: defineTable({
    userId: v.id("users"),
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
    mediaType: mediaTypeValidator,
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"])
    .index("by_user_and_media_type_and_work_id", ["userId", "mediaType", "workId"]),
  mediaReviews: defineTable({
    userId: v.id("users"),
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
    mediaType: mediaTypeValidator,
    rating: v.number(),
    comment: v.string(),
    updatedAt: v.number(),
  })
    .index("by_media_type_and_movie_id", ["mediaType", "movieId"])
    .index("by_media_type_and_work_id", ["mediaType", "workId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"])
    .index("by_user_and_media_type_and_work_id", ["userId", "mediaType", "workId"]),
  userSettings: defineTable({
    userId: v.id("users"),
    realDebridApiKey: v.optional(v.string()),
    streamMode: v.optional(streamModeValidator),
    externalPlayer: v.optional(externalPlayerValidator),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
