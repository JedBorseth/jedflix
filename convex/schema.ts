import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  movies: defineTable({
    title: v.string(),
    description: v.string(),
    posterUrl: v.string(),
    backdropUrl: v.string(),
    genre: v.string(),
    year: v.number(),
    durationMinutes: v.number(),
    rating: v.string(),
    featured: v.optional(v.boolean()),
  })
    .index("by_genre", ["genre"])
    .index("by_featured", ["featured"]),
  watchHistory: defineTable({
    userId: v.id("users"),
    movieId: v.id("movies"),
    progressSeconds: v.number(),
    lastWatchedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_movie", ["userId", "movieId"]),
});
