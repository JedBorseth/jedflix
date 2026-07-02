import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  watchHistory: defineTable({
    userId: v.id("users"),
    movieId: v.number(),
    mediaType: v.union(v.literal("movie"), v.literal("tv")),
    progressSeconds: v.number(),
    lastWatchedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"]),
});
