import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const JEDS_PICKS_ADMIN_EMAIL = "jedborseth@gmail.com";
const MAX_PICKS = 100;

const categoryValidator = v.union(
  v.literal("movie"),
  v.literal("tv"),
  v.literal("audiobook"),
  v.literal("music"),
);

const kindValidator = v.union(
  v.literal("movie"),
  v.literal("tv"),
  v.literal("audiobook"),
  v.literal("album"),
  v.literal("artist"),
);

const pickIdentityArgs = {
  kind: kindValidator,
  movieId: v.optional(v.number()),
  workId: v.optional(v.string()),
  catalogId: v.optional(v.string()),
};

const pickReturnValidator = v.object({
  _id: v.id("jedsPicks"),
  category: categoryValidator,
  kind: kindValidator,
  movieId: v.optional(v.number()),
  workId: v.optional(v.string()),
  catalogId: v.optional(v.string()),
  addedAt: v.number(),
});

type PickKind = "movie" | "tv" | "audiobook" | "album" | "artist";

type PickIdentity = {
  kind: PickKind;
  movieId?: number;
  workId?: string;
  catalogId?: string;
};

function categoryForKind(kind: PickKind): "movie" | "tv" | "audiobook" | "music" {
  if (kind === "album" || kind === "artist") {
    return "music";
  }
  return kind;
}

function assertPickIdentity(args: PickIdentity) {
  if (args.kind === "movie" || args.kind === "tv") {
    if (args.movieId === undefined) {
      throw new Error("movieId is required for movie/tv picks");
    }
    return;
  }
  if (args.kind === "audiobook") {
    if (!args.workId?.trim()) {
      throw new Error("workId is required for audiobook picks");
    }
    return;
  }
  if (!args.catalogId?.trim()) {
    throw new Error("catalogId is required for album/artist picks");
  }
}

function userEmail(user: Doc<"users"> | null): string | undefined {
  return user?.email?.trim().toLowerCase();
}

async function viewerIsJedsPicksAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return false;
  }

  const user = await ctx.db.get(userId);
  if (userEmail(user) === JEDS_PICKS_ADMIN_EMAIL) {
    return true;
  }

  const identity = await ctx.auth.getUserIdentity();
  return identity?.email?.trim().toLowerCase() === JEDS_PICKS_ADMIN_EMAIL;
}

async function findPick(ctx: QueryCtx | MutationCtx, args: PickIdentity) {
  if (args.kind === "movie" || args.kind === "tv") {
    return await ctx.db
      .query("jedsPicks")
      .withIndex("by_kind_and_movie_id", (q) =>
        q.eq("kind", args.kind).eq("movieId", args.movieId!),
      )
      .unique();
  }
  if (args.kind === "audiobook") {
    const workId = args.workId!.trim();
    return await ctx.db
      .query("jedsPicks")
      .withIndex("by_kind_and_work_id", (q) =>
        q.eq("kind", args.kind).eq("workId", workId),
      )
      .unique();
  }
  const catalogId = args.catalogId!.trim();
  return await ctx.db
    .query("jedsPicks")
    .withIndex("by_kind_and_catalog_id", (q) =>
      q.eq("kind", args.kind).eq("catalogId", catalogId),
    )
    .unique();
}

function toPickReturn(doc: Doc<"jedsPicks">) {
  return {
    _id: doc._id,
    category: doc.category,
    kind: doc.kind,
    movieId: doc.movieId,
    workId: doc.workId,
    catalogId: doc.catalogId,
    addedAt: doc.addedAt,
  };
}

export const canManage = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await viewerIsJedsPicksAdmin(ctx);
  },
});

export const list = query({
  args: {},
  returns: v.array(pickReturnValidator),
  handler: async (ctx) => {
    const items = await ctx.db.query("jedsPicks").take(MAX_PICKS);
    return items.sort((a, b) => b.addedAt - a.addedAt).map(toPickReturn);
  },
});

export const toggle = mutation({
  args: pickIdentityArgs,
  returns: v.object({ saved: v.boolean() }),
  handler: async (ctx, args) => {
    if (!(await viewerIsJedsPicksAdmin(ctx))) {
      throw new Error("Only Jed can update Jed's Picks");
    }

    assertPickIdentity(args);
    const existing = await findPick(ctx, args);
    if (existing) {
      await ctx.db.delete(existing._id);
      return { saved: false };
    }

    const category = categoryForKind(args.kind);
    await ctx.db.insert("jedsPicks", {
      category,
      kind: args.kind,
      movieId: args.kind === "movie" || args.kind === "tv" ? args.movieId : undefined,
      workId: args.kind === "audiobook" ? args.workId!.trim() : undefined,
      catalogId:
        args.kind === "album" || args.kind === "artist"
          ? args.catalogId!.trim()
          : undefined,
      addedAt: Date.now(),
    });
    return { saved: true };
  },
});
