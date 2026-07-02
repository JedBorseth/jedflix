import { v } from "convex/values";
import { query } from "./_generated/server";

export const listFeatured = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("movies")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .take(1);
  },
});

export const listByGenre = query({
  args: { genre: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("movies")
      .withIndex("by_genre", (q) => q.eq("genre", args.genre))
      .collect();
  },
});

export const getById = query({
  args: { movieId: v.id("movies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.movieId);
  },
});

export const listGenres = query({
  args: {},
  handler: async (ctx) => {
    const movies = await ctx.db.query("movies").collect();
    return [...new Set(movies.map((movie) => movie.genre))].sort();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("movies").collect();
  },
});
