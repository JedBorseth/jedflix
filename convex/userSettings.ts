import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const streamModeValidator = v.union(v.literal("direct"), v.literal("proxy"));
const externalPlayerValidator = v.union(
  v.literal("disabled"),
  v.literal("vlc"),
  v.literal("outplayer"),
);

export const getForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    return await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    realDebridApiKey: v.optional(v.union(v.string(), v.null())),
    streamMode: v.optional(streamModeValidator),
    externalPlayer: v.optional(externalPlayerValidator),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to save settings");
    }

    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const patch: {
      realDebridApiKey?: string;
      streamMode?: "direct" | "proxy";
      externalPlayer?: "disabled" | "vlc" | "outplayer";
      updatedAt: number;
    } = {
      updatedAt: args.updatedAt ?? Date.now(),
    };
    if (args.realDebridApiKey !== undefined) {
      patch.realDebridApiKey = args.realDebridApiKey ?? undefined;
    }
    if (args.streamMode !== undefined) {
      patch.streamMode = args.streamMode;
    }
    if (args.externalPlayer !== undefined) {
      patch.externalPlayer = args.externalPlayer;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    const doc: {
      userId: typeof userId;
      realDebridApiKey?: string;
      streamMode?: "direct" | "proxy";
      externalPlayer?: "disabled" | "vlc" | "outplayer";
      updatedAt: number;
    } = {
      userId,
      updatedAt: patch.updatedAt,
    };
    if (patch.realDebridApiKey !== undefined) {
      doc.realDebridApiKey = patch.realDebridApiKey;
    }
    if (patch.streamMode !== undefined) {
      doc.streamMode = patch.streamMode;
    }
    if (patch.externalPlayer !== undefined) {
      doc.externalPlayer = patch.externalPlayer;
    }

    return await ctx.db.insert("userSettings", doc);
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to clear settings");
    }

    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
