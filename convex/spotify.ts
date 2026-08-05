import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import {
  buildAuthorizeUrl,
  hasImportScopes,
  isSpotifyConfigured,
  refreshAccessToken,
} from "./spotifyApi";

const OAUTH_STATE_TTL_MS = 10 * 60_000;

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Public view of a linked account — token material is never returned to clients. */
const publicAccountValidator = v.union(
  v.object({
    _id: v.id("spotifyAccounts"),
    spotifyUserId: v.string(),
    displayName: v.string(),
    product: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isPremium: v.boolean(),
    canImportPlaylists: v.boolean(),
  }),
  v.null(),
);

export const getMyAccount = query({
  args: {},
  returns: publicAccountValidator,
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const account = await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) {
      return null;
    }
    return {
      _id: account._id,
      spotifyUserId: account.spotifyUserId,
      displayName: account.displayName,
      product: account.product,
      imageUrl: account.imageUrl,
      isPremium: account.product === "premium",
      canImportPlaylists: hasImportScopes(account.scope),
    };
  },
});

export const isConfigured = query({
  args: {},
  returns: v.boolean(),
  handler: async () => isSpotifyConfigured(),
});

export const startLink = action({
  args: { redirectPath: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    if (!isSpotifyConfigured()) {
      throw new Error(
        "Spotify is not configured on the server. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
      );
    }
    const state = randomState();
    await ctx.runMutation(internal.spotify.createOauthState, {
      state,
      redirectPath: normalizeRedirectPath(args.redirectPath),
    });
    return buildAuthorizeUrl(state);
  },
});

export const unlink = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to unlink Spotify");
    }
    const account = await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (account) {
      await ctx.db.delete(account._id);
    }
    const targets = await ctx.db
      .query("partySpotifyTargets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    for (const target of targets) {
      await ctx.db.delete(target._id);
    }
    return null;
  },
});

// --- Internal ---------------------------------------------------------------

export const getMyAccountInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    return await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getAccount = internalQuery({
  args: { accountId: v.id("spotifyAccounts") },
  handler: async (ctx, args) => await ctx.db.get(args.accountId),
});

export const getAccountByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique(),
});

export const createOauthState = internalMutation({
  args: { state: v.string(), redirectPath: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to link Spotify");
    }
    // Abandoned attempts are never consumed, so clear this user's old ones.
    const stale = await ctx.db.query("spotifyOauthStates").take(50);
    for (const row of stale) {
      if (row.userId === userId || row.expiresAt < Date.now()) {
        await ctx.db.delete(row._id);
      }
    }
    await ctx.db.insert("spotifyOauthStates", {
      state: args.state,
      userId,
      redirectPath: args.redirectPath,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    });
    return null;
  },
});

export const consumeOauthState = internalMutation({
  args: { state: v.string() },
  returns: v.union(
    v.object({ userId: v.id("users"), redirectPath: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("spotifyOauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) {
      return null;
    }
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) {
      return null;
    }
    return { userId: row.userId, redirectPath: row.redirectPath };
  },
});

export const saveAccount = internalMutation({
  args: {
    userId: v.id("users"),
    spotifyUserId: v.string(),
    displayName: v.string(),
    product: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scope: v.string(),
  },
  returns: v.id("spotifyAccounts"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("spotifyAccounts", doc);
  },
});

export const updateTokens = internalMutation({
  args: {
    accountId: v.id("spotifyAccounts"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
    scope: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) {
      return null;
    }
    await ctx.db.patch(args.accountId, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken ?? account.refreshToken,
      expiresAt: args.expiresAt,
      scope: args.scope,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// --- Helpers ----------------------------------------------------------------

function normalizeRedirectPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/music";
  }
  return raw;
}

/**
 * Returns a valid access token for the account, refreshing it first when the
 * stored one is at or near expiry.
 */
export async function ensureAccessToken(
  ctx: ActionCtx,
  accountId: Id<"spotifyAccounts">,
): Promise<string> {
  const account = await ctx.runQuery(internal.spotify.getAccount, { accountId });
  if (!account) {
    throw new Error("Spotify account is no longer linked");
  }
  if (account.expiresAt > Date.now()) {
    return account.accessToken;
  }

  const tokens = await refreshAccessToken(account.refreshToken);
  await ctx.runMutation(internal.spotify.updateTokens, {
    accountId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? undefined,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  });
  return tokens.accessToken;
}
