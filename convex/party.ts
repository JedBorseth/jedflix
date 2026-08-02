import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  generatePartyCode,
  isValidPartyCode,
  MEMBER_STALE_WINDOW_MS,
  normalizePartyCode,
  partyTrackValidator,
  trimQueue,
  type PartyTrack,
} from "./partyModel";

const MAX_CODE_ATTEMPTS = 8;
const MAX_MEMBERS = 25;

// --- Shared read helpers ----------------------------------------------------

async function findMembership(
  ctx: QueryCtx,
  userId: Id<"users">,
  clientId: string,
): Promise<Doc<"partyMembers"> | null> {
  return await ctx.db
    .query("partyMembers")
    .withIndex("by_user_and_client", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .unique();
}

async function requireMembership(
  ctx: MutationCtx,
  clientId: string,
): Promise<{ userId: Id<"users">; member: Doc<"partyMembers">; party: Doc<"parties"> }> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Must be signed in to use party mode");
  }
  const member = await findMembership(ctx, userId, clientId);
  if (!member) {
    throw new Error("This device is not in a party");
  }
  const party = await ctx.db.get(member.partyId);
  if (!party || party.closedAt !== undefined) {
    throw new Error("Party has ended");
  }
  return { userId, member, party };
}

async function getPlayback(
  ctx: QueryCtx,
  partyId: Id<"parties">,
): Promise<Doc<"partyPlayback"> | null> {
  return await ctx.db
    .query("partyPlayback")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .unique();
}

async function getQueue(
  ctx: QueryCtx,
  partyId: Id<"parties">,
): Promise<Doc<"partyQueue"> | null> {
  return await ctx.db
    .query("partyQueue")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .unique();
}

// --- Shared write helpers ---------------------------------------------------

/**
 * Applies a playback change, bumps the revision, and hands the result to the
 * Spotify bridge. The revision lets the scheduled push bail out if another
 * change lands first.
 */
async function commitPlayback(
  ctx: MutationCtx,
  args: {
    partyId: Id<"parties">;
    updatedBy: string;
    track?: PartyTrack | undefined;
    queueIndex?: number;
    isPlaying?: boolean;
    /** Account whose own Spotify report caused this change; it is not pushed back. */
    originAccountId?: Id<"spotifyAccounts">;
  },
): Promise<void> {
  const existing = await getPlayback(ctx, args.partyId);
  const now = Date.now();
  const revision = (existing?.revision ?? 0) + 1;

  const next = {
    partyId: args.partyId,
    track: args.track !== undefined ? args.track : existing?.track,
    queueIndex: args.queueIndex ?? existing?.queueIndex ?? -1,
    isPlaying: args.isPlaying ?? existing?.isPlaying ?? false,
    revision,
    updatedBy: args.updatedBy,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.replace(existing._id, next);
  } else {
    await ctx.db.insert("partyPlayback", next);
  }

  await ctx.scheduler.runAfter(0, internal.partySync.pushToSpotify, {
    partyId: args.partyId,
    revision,
    skipAccountId: args.originAccountId,
  });
}

/**
 * Starts the Spotify poll loop for a party if it is not already running.
 * `pollGeneration` fences off loops left over from a previous run.
 */
export async function ensurePolling(ctx: MutationCtx, party: Doc<"parties">): Promise<void> {
  if (party.pollRunning) {
    return;
  }
  const generation = party.pollGeneration + 1;
  await ctx.db.patch(party._id, { pollRunning: true, pollGeneration: generation });
  await ctx.scheduler.runAfter(0, internal.partySync.pollParty, {
    partyId: party._id,
    generation,
  });
}

async function pruneStaleMembers(ctx: MutationCtx, partyId: Id<"parties">): Promise<number> {
  const cutoff = Date.now() - MEMBER_STALE_WINDOW_MS;
  const members = await ctx.db
    .query("partyMembers")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .take(MAX_MEMBERS + 10);
  let remaining = 0;
  for (const member of members) {
    if (member.lastSeenAt < cutoff) {
      await ctx.db.delete(member._id);
    } else {
      remaining += 1;
    }
  }
  return remaining;
}

async function closePartyIfEmpty(ctx: MutationCtx, partyId: Id<"parties">): Promise<void> {
  const member = await ctx.db
    .query("partyMembers")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .first();
  if (member) {
    return;
  }
  const party = await ctx.db.get(partyId);
  if (party && party.closedAt === undefined) {
    await ctx.db.patch(partyId, { closedAt: Date.now() });
  }
}

// --- Public API -------------------------------------------------------------

const memberValidator = v.object({
  _id: v.id("partyMembers"),
  clientId: v.string(),
  deviceLabel: v.string(),
  userName: v.string(),
  isSelf: v.boolean(),
  isHost: v.boolean(),
  // Freshness is judged on the client so this query stays free of Date.now().
  lastSeenAt: v.number(),
});

const targetValidator = v.object({
  _id: v.id("partySpotifyTargets"),
  accountId: v.id("spotifyAccounts"),
  accountName: v.string(),
  userName: v.string(),
  isSelf: v.boolean(),
  enabled: v.boolean(),
  deviceId: v.union(v.string(), v.null()),
  deviceName: v.union(v.string(), v.null()),
  lastError: v.union(v.string(), v.null()),
});

export const getState = query({
  args: { clientId: v.string() },
  returns: v.union(
    v.object({
      partyId: v.id("parties"),
      code: v.string(),
      isHost: v.boolean(),
      track: v.union(partyTrackValidator, v.null()),
      queue: v.array(partyTrackValidator),
      queueIndex: v.number(),
      isPlaying: v.boolean(),
      revision: v.number(),
      updatedBy: v.string(),
      members: v.array(memberValidator),
      spotifyTargets: v.array(targetValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const membership = await findMembership(ctx, userId, args.clientId);
    if (!membership) {
      return null;
    }
    const party = await ctx.db.get(membership.partyId);
    if (!party || party.closedAt !== undefined) {
      return null;
    }

    const [playback, queueDoc, memberDocs, targetDocs] = await Promise.all([
      getPlayback(ctx, party._id),
      getQueue(ctx, party._id),
      ctx.db
        .query("partyMembers")
        .withIndex("by_party", (q) => q.eq("partyId", party._id))
        .take(MAX_MEMBERS),
      ctx.db
        .query("partySpotifyTargets")
        .withIndex("by_party", (q) => q.eq("partyId", party._id))
        .take(MAX_MEMBERS),
    ]);

    const members = await Promise.all(
      memberDocs.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return {
          _id: member._id,
          clientId: member.clientId,
          deviceLabel: member.deviceLabel,
          userName: user?.name ?? user?.email ?? "Someone",
          isSelf: member.clientId === args.clientId,
          isHost: member.userId === party.hostUserId,
          lastSeenAt: member.lastSeenAt,
        };
      }),
    );

    const spotifyTargets = await Promise.all(
      targetDocs.map(async (target) => {
        const [account, user] = await Promise.all([
          ctx.db.get(target.accountId),
          ctx.db.get(target.userId),
        ]);
        return {
          _id: target._id,
          accountId: target.accountId,
          accountName: account?.displayName ?? "Spotify account",
          userName: user?.name ?? user?.email ?? "Someone",
          isSelf: target.userId === userId,
          enabled: target.enabled,
          deviceId: target.deviceId ?? null,
          deviceName: target.deviceName ?? null,
          lastError: target.lastError ?? null,
        };
      }),
    );

    return {
      partyId: party._id,
      code: party.code,
      isHost: party.hostUserId === userId,
      track: playback?.track ?? null,
      queue: queueDoc?.tracks ?? [],
      queueIndex: playback?.queueIndex ?? -1,
      isPlaying: playback?.isPlaying ?? false,
      revision: playback?.revision ?? 0,
      updatedBy: playback?.updatedBy ?? "",
      members,
      spotifyTargets,
    };
  },
});

export const create = mutation({
  args: { clientId: v.string(), deviceLabel: v.string() },
  returns: v.object({ partyId: v.id("parties"), code: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to start a party");
    }
    await leaveCurrentParty(ctx, userId, args.clientId);

    let code = "";
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = generatePartyCode();
      const clash = await ctx.db
        .query("parties")
        .withIndex("by_code", (q) => q.eq("code", candidate))
        .first();
      if (!clash || clash.closedAt !== undefined) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error("Could not allocate a party code. Try again.");
    }

    const now = Date.now();
    const partyId = await ctx.db.insert("parties", {
      code,
      hostUserId: userId,
      pollRunning: false,
      pollGeneration: 0,
      createdAt: now,
    });
    await ctx.db.insert("partyMembers", {
      partyId,
      userId,
      clientId: args.clientId,
      deviceLabel: args.deviceLabel,
      lastSeenAt: now,
      joinedAt: now,
    });
    await ctx.db.insert("partyPlayback", {
      partyId,
      queueIndex: -1,
      isPlaying: false,
      revision: 0,
      updatedBy: `member:${args.clientId}`,
      updatedAt: now,
    });

    return { partyId, code };
  },
});

export const join = mutation({
  args: { code: v.string(), clientId: v.string(), deviceLabel: v.string() },
  returns: v.object({ partyId: v.id("parties"), code: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to join a party");
    }
    if (!isValidPartyCode(args.code)) {
      throw new Error("That party code doesn't look right");
    }
    const code = normalizePartyCode(args.code);
    const party = await ctx.db
      .query("parties")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!party || party.closedAt !== undefined) {
      throw new Error("No active party with that code");
    }

    await leaveCurrentParty(ctx, userId, args.clientId);

    const remaining = await pruneStaleMembers(ctx, party._id);
    if (remaining >= MAX_MEMBERS) {
      throw new Error("This party is full");
    }

    const now = Date.now();
    await ctx.db.insert("partyMembers", {
      partyId: party._id,
      userId,
      clientId: args.clientId,
      deviceLabel: args.deviceLabel,
      lastSeenAt: now,
      joinedAt: now,
    });
    await ensurePolling(ctx, party);

    return { partyId: party._id, code: party.code };
  },
});

export const leave = mutation({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    await leaveCurrentParty(ctx, userId, args.clientId);
    return null;
  },
});

export const heartbeat = mutation({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const member = await findMembership(ctx, userId, args.clientId);
    if (!member) {
      return null;
    }
    await ctx.db.patch(member._id, { lastSeenAt: Date.now() });

    const party = await ctx.db.get(member.partyId);
    if (party && party.closedAt === undefined) {
      await ensurePolling(ctx, party);
    }
    return null;
  },
});

export const setTrack = mutation({
  args: {
    clientId: v.string(),
    track: partyTrackValidator,
    queueIndex: v.number(),
    /** Only sent when the client's queue actually changed. */
    queue: v.optional(v.array(partyTrackValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member, party } = await requireMembership(ctx, args.clientId);

    const current = await getPlayback(ctx, member.partyId);
    if (
      !args.queue &&
      current?.track?.id === args.track.id &&
      current.queueIndex === args.queueIndex &&
      current.isPlaying
    ) {
      // Another client already reported this track; nothing to broadcast.
      return null;
    }

    if (args.queue) {
      const tracks = trimQueue(args.queue);
      const existing = await getQueue(ctx, member.partyId);
      if (existing) {
        await ctx.db.patch(existing._id, { tracks, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("partyQueue", {
          partyId: member.partyId,
          tracks,
          updatedAt: Date.now(),
        });
      }
    }

    await commitPlayback(ctx, {
      partyId: member.partyId,
      updatedBy: `member:${args.clientId}`,
      track: args.track,
      queueIndex: args.queueIndex,
      isPlaying: true,
    });
    await ensurePolling(ctx, party);
    return null;
  },
});

export const setPlaying = mutation({
  args: { clientId: v.string(), isPlaying: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireMembership(ctx, args.clientId);
    const playback = await getPlayback(ctx, member.partyId);
    if (playback && playback.isPlaying === args.isPlaying) {
      return null;
    }
    await commitPlayback(ctx, {
      partyId: member.partyId,
      updatedBy: `member:${args.clientId}`,
      isPlaying: args.isPlaying,
    });
    return null;
  },
});

export const setSpotifyTarget = mutation({
  args: {
    clientId: v.string(),
    enabled: v.boolean(),
    deviceId: v.optional(v.union(v.string(), v.null())),
    deviceName: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, member, party } = await requireMembership(ctx, args.clientId);
    const account = await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) {
      throw new Error("Connect a Spotify account first");
    }

    const existing = await ctx.db
      .query("partySpotifyTargets")
      .withIndex("by_party_and_account", (q) =>
        q.eq("partyId", member.partyId).eq("accountId", account._id),
      )
      .unique();

    const now = Date.now();
    const deviceId = args.deviceId === undefined ? existing?.deviceId : (args.deviceId ?? undefined);
    const deviceName =
      args.deviceName === undefined ? existing?.deviceName : (args.deviceName ?? undefined);

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        deviceId,
        deviceName,
        lastError: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("partySpotifyTargets", {
        partyId: member.partyId,
        accountId: account._id,
        userId,
        enabled: args.enabled,
        deviceId,
        deviceName,
        lastPushedAt: 0,
        updatedAt: now,
      });
    }

    if (args.enabled) {
      await ensurePolling(ctx, party);
      // Hand the device whatever the party is already playing.
      const playback = await getPlayback(ctx, member.partyId);
      if (playback?.track) {
        await ctx.scheduler.runAfter(0, internal.partySync.pushToSpotify, {
          partyId: member.partyId,
          revision: playback.revision,
          force: true,
        });
      }
    }
    return null;
  },
});

// --- Internal (used by the Spotify bridge) ----------------------------------

export const getSyncSnapshot = internalQuery({
  args: { partyId: v.id("parties") },
  handler: async (ctx, args) => {
    const party = await ctx.db.get(args.partyId);
    if (!party) {
      return null;
    }
    const [playback, queueDoc, targets] = await Promise.all([
      getPlayback(ctx, args.partyId),
      getQueue(ctx, args.partyId),
      ctx.db
        .query("partySpotifyTargets")
        .withIndex("by_party", (q) => q.eq("partyId", args.partyId))
        .take(MAX_MEMBERS),
    ]);
    const members = await ctx.db
      .query("partyMembers")
      .withIndex("by_party", (q) => q.eq("partyId", args.partyId))
      .take(MAX_MEMBERS);

    return {
      party,
      playback,
      queue: queueDoc?.tracks ?? [],
      targets: targets.filter((target) => target.enabled),
      // The caller is an action, so it decides what counts as stale.
      lastMemberSeenAt: members.reduce((latest, member) => Math.max(latest, member.lastSeenAt), 0),
    };
  },
});

/** Drops members that stopped sending heartbeats and closes an empty party. */
export const sweepParty = internalMutation({
  args: { partyId: v.id("parties") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await pruneStaleMembers(ctx, args.partyId);
    await closePartyIfEmpty(ctx, args.partyId);
    return null;
  },
});

export const recordPush = internalMutation({
  args: {
    targetId: v.id("partySpotifyTargets"),
    trackId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target) {
      return null;
    }
    await ctx.db.patch(args.targetId, {
      lastPushedTrackId: args.trackId ?? target.lastPushedTrackId,
      lastPushedAt: Date.now(),
      lastObservedTrackId: args.trackId ?? target.lastObservedTrackId,
      lastError: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordObservation = internalMutation({
  args: {
    targetId: v.id("partySpotifyTargets"),
    trackId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target) {
      return null;
    }
    await ctx.db.patch(args.targetId, {
      lastObservedTrackId: args.trackId,
      lastError: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Applies a change that a member's own Spotify client made. */
export const applySpotifyChange = internalMutation({
  args: {
    partyId: v.id("parties"),
    accountId: v.id("spotifyAccounts"),
    track: v.optional(partyTrackValidator),
    isPlaying: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const party = await ctx.db.get(args.partyId);
    if (!party || party.closedAt !== undefined) {
      return null;
    }
    const queueDoc = await getQueue(ctx, args.partyId);
    const queueIndex = args.track
      ? (queueDoc?.tracks.findIndex((item) => item.id === args.track?.id) ?? -1)
      : -1;

    await commitPlayback(ctx, {
      partyId: args.partyId,
      updatedBy: `spotify:${args.accountId}`,
      track: args.track,
      queueIndex,
      isPlaying: args.isPlaying,
      originAccountId: args.accountId,
    });
    return null;
  },
});

export const stopPolling = internalMutation({
  args: { partyId: v.id("parties") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const party = await ctx.db.get(args.partyId);
    if (party?.pollRunning) {
      await ctx.db.patch(args.partyId, { pollRunning: false });
    }
    return null;
  },
});

// --- Internals --------------------------------------------------------------

async function leaveCurrentParty(
  ctx: MutationCtx,
  userId: Id<"users">,
  clientId: string,
): Promise<void> {
  const member = await findMembership(ctx, userId, clientId);
  if (!member) {
    return;
  }
  const partyId = member.partyId;
  await ctx.db.delete(member._id);

  // Drop this user's Spotify mirror when none of their devices remain.
  const stillPresent = await ctx.db
    .query("partyMembers")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .take(MAX_MEMBERS);
  if (!stillPresent.some((other) => other.userId === userId)) {
    const target = await ctx.db
      .query("partySpotifyTargets")
      .withIndex("by_party", (q) => q.eq("partyId", partyId))
      .take(MAX_MEMBERS);
    for (const row of target) {
      if (row.userId === userId) {
        await ctx.db.delete(row._id);
      }
    }
  }

  await closePartyIfEmpty(ctx, partyId);
}
