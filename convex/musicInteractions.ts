import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

const kindValidator = v.union(
  v.literal("play"),
  v.literal("skip"),
  v.literal("complete"),
  v.literal("select"),
  v.literal("search"),
  v.literal("click"),
);

export const log = mutation({
  args: {
    kind: kindValidator,
    trackId: v.optional(v.string()),
    title: v.optional(v.string()),
    artists: v.optional(v.array(v.string())),
    query: v.optional(v.string()),
    resultId: v.optional(v.string()),
    resultKind: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    await ctx.db.insert("musicInteractions", {
      userId,
      kind: args.kind,
      trackId: args.trackId,
      title: args.title,
      artists: args.artists,
      query: args.query,
      resultId: args.resultId,
      resultKind: args.resultKind,
      createdAt: Date.now(),
    });
    return null;
  },
});
