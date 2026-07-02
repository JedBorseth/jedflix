import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const mediaTypeValidator = v.union(v.literal("movie"), v.literal("tv"));

export default defineSchema({
  ...authTables,
  watchHistory: defineTable({
    userId: v.id("users"),
    movieId: v.number(),
    mediaType: mediaTypeValidator,
    progressSeconds: v.number(),
    lastWatchedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"]),
  myList: defineTable({
    userId: v.id("users"),
    movieId: v.number(),
    mediaType: mediaTypeValidator,
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"]),
  mediaReviews: defineTable({
    userId: v.id("users"),
    movieId: v.number(),
    mediaType: mediaTypeValidator,
    rating: v.number(),
    comment: v.string(),
    updatedAt: v.number(),
  })
    .index("by_media_type_and_movie_id", ["mediaType", "movieId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"]),
});
