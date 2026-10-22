import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
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
  estimatedPositionMs,
  generatePartyCode,
  isValidPartyCode,
  HEARTBEAT_WRITE_MIN_INTERVAL_MS,
  MEMBER_STALE_WINDOW_MS,
  normalizePartyCode,
  partyTrackValidator,
  shouldSyncPosition,
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
    .withIndex("by_user_and_client", (q) =>
      q.eq("userId", userId).eq("clientId", clientId),
    )
    .unique();
}

async function requireMembership(
  ctx: MutationCtx,
  clientId: string,
): Promise<{
  userId: Id<"users">;
  member: Doc<"partyMembers">;
  party: Doc<"parties">;
}> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Must be signed in to use party mode");
  }
  const member = await findMembership(ctx, userId, clientId);
  if (!member) {
    throw new ConvexError("This device is not in a party");
  }
  const party = await ctx.db.get(member.partyId);
  if (!party || party.closedAt !== undefined) {
    throw new ConvexError("Party has ended");
  }
  return { userId, member, party };
}

async function guestTokenHash(token: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new ConvexError("Invalid guest session. Open the party link again.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function findGuest(ctx: QueryCtx, token: string) {
  const hash = await guestTokenHash(token);
  return ctx.db
    .query("partyGuests")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
    .unique();
}

async function requirePlaybackMembership(
  ctx: MutationCtx,
  clientId: string,
  guestToken?: string,
) {
  if (!guestToken) return requireMembership(ctx, clientId);
  const member = await findGuest(ctx, guestToken);
  if (!member) throw new ConvexError("This device is not in a party");
  const party = await ctx.db.get(member.partyId);
  if (!party || party.closedAt !== undefined)
    throw new ConvexError("Party has ended");
  return { member, party };
}

async function requireRecentHost(ctx: QueryCtx, party: Doc<"parties">) {
  const members = await ctx.db
    .query("partyMembers")
    .withIndex("by_party", (q) => q.eq("partyId", party._id))
    .take(MAX_MEMBERS);
  if (
    !members.some(
      (member) =>
        member.userId === party.hostUserId &&
        Date.now() - member.lastSeenAt < MEMBER_STALE_WINDOW_MS,
    )
  ) {
    throw new ConvexError(
      "The host has been offline for 5 minutes. This party has ended.",
    );
  }
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

function nameFromUser(user: Doc<"users"> | null | undefined): string {
  return user?.name ?? user?.email ?? "Someone";
}

async function loadDocsById<TableName extends "users" | "spotifyAccounts">(
  ctx: QueryCtx,
  ids: Id<TableName>[],
) {
  const unique = [...new Set(ids)];
  const docs = await Promise.all(unique.map((id) => ctx.db.get(id)));
  const byId = new Map<Id<TableName>, NonNullable<(typeof docs)[number]>>();
  for (const doc of docs) {
    if (doc) {
      byId.set(doc._id, doc);
    }
  }
  return byId;
}

// --- Shared write helpers ---------------------------------------------------

/**
 * Applies a playback change and bumps the revision. Track and seek stay
 * Spotify-owned when following; JedFlix only pushes pause/resume to linked
 * Spotify accounts. JedFlix clients sync with each other via `getState`.
 */
async function commitPlayback(
  ctx: MutationCtx,
  args: {
    partyId: Id<"parties">;
    updatedBy: string;
    track?: PartyTrack | undefined;
    queueIndex?: number;
    isPlaying?: boolean;
    /** Explicit seek / Spotify progress. When omitted, the clock is frozen at the estimated position. */
    positionMs?: number;
  },
): Promise<void> {
  const existing = await getPlayback(ctx, args.partyId);
  const now = Date.now();
  const revision = (existing?.revision ?? 0) + 1;

  const prevPlaying = existing?.isPlaying ?? false;
  const nextTrack = args.track !== undefined ? args.track : existing?.track;
  const trackChanged =
    args.track !== undefined &&
    (args.track?.id ?? null) !== (existing?.track?.id ?? null);
  const nextPlaying = args.isPlaying ?? prevPlaying;
  const playingChanged =
    args.isPlaying !== undefined && args.isPlaying !== prevPlaying;

  const estimated = estimatedPositionMs({
    positionMs: existing?.positionMs ?? 0,
    positionUpdatedAt: existing?.positionUpdatedAt ?? now,
    isPlaying: prevPlaying,
    now,
    durationMs: existing?.track?.durationMs,
  });

  let positionMs: number;
  if (args.positionMs !== undefined) {
    positionMs = Math.max(0, args.positionMs);
  } else if (trackChanged) {
    positionMs = 0;
  } else {
    // Freeze the clock at the moment of this change so pause/resume stays accurate.
    positionMs = estimated;
  }

  const next = {
    partyId: args.partyId,
    track: nextTrack,
    queueIndex: args.queueIndex ?? existing?.queueIndex ?? -1,
    isPlaying: nextPlaying,
    positionMs,
    positionUpdatedAt: now,
    revision,
    updatedBy: args.updatedBy,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.replace(existing._id, next);
  } else {
    await ctx.db.insert("partyPlayback", next);
  }

  // Only JedFlix-originated play/pause is mirrored to Spotify — never tracks or seeks.
  if (playingChanged && !args.updatedBy.startsWith("spotify:")) {
    await ctx.scheduler.runAfter(0, internal.partySync.pushPlayStateToSpotify, {
      partyId: args.partyId,
      revision,
      isPlaying: nextPlaying,
    });
  }
}

/**
 * Starts the Spotify poll loop for a party if it is not already running.
 * `pollGeneration` fences off loops left over from a previous run.
 */
export async function ensurePolling(
  ctx: MutationCtx,
  party: Doc<"parties">,
): Promise<void> {
  // Existing parties acquire the expiry check on their next heartbeat/join.
  if (!party.expiryScheduled) {
    const members = await ctx.db
      .query("partyMembers")
      .withIndex("by_party", (q) => q.eq("partyId", party._id))
      .take(MAX_MEMBERS);
    const lastHostSeenAt = members.reduce(
      (latest, member) =>
        member.userId === party.hostUserId
          ? Math.max(latest, member.lastSeenAt)
          : latest,
      0,
    );
    await ctx.scheduler.runAfter(
      Math.max(0, lastHostSeenAt + MEMBER_STALE_WINDOW_MS - Date.now()),
      internal.party.sweepParty,
      { partyId: party._id },
    );
    await ctx.db.patch(party._id, { expiryScheduled: true });
  }
  if (party.pollRunning) {
    return;
  }
  const generation = party.pollGeneration + 1;
  await ctx.db.patch(party._id, {
    pollRunning: true,
    pollGeneration: generation,
  });
  await ctx.scheduler.runAfter(0, internal.partySync.pollParty, {
    partyId: party._id,
    generation,
  });
}

async function pruneStaleMembers(
  ctx: MutationCtx,
  partyId: Id<"parties">,
): Promise<number> {
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
  const guests = await ctx.db
    .query("partyGuests")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .take(MAX_MEMBERS + 1);
  for (const guest of guests) {
    if (guest.lastSeenAt < cutoff) await ctx.db.delete(guest._id);
    else remaining += 1;
  }
  return remaining;
}

async function closePartyIfEmpty(
  ctx: MutationCtx,
  partyId: Id<"parties">,
): Promise<void> {
  const member = await ctx.db
    .query("partyMembers")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .first();
  const guest = await ctx.db
    .query("partyGuests")
    .withIndex("by_party", (q) => q.eq("partyId", partyId))
    .first();
  if (member || guest) return;
  const party = await ctx.db.get(partyId);
  if (party && party.closedAt === undefined) {
    await ctx.db.patch(partyId, { closedAt: Date.now() });
  }
}

// --- Public API -------------------------------------------------------------

const memberValidator = v.object({
  _id: v.union(v.id("partyMembers"), v.id("partyGuests")),
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

const partyStateValidator = v.union(
  v.object({
    partyId: v.id("parties"),
    code: v.string(),
    isHost: v.boolean(),
    track: v.union(partyTrackValidator, v.null()),
    queue: v.array(partyTrackValidator),
    queueIndex: v.number(),
    isPlaying: v.boolean(),
    positionMs: v.number(),
    positionUpdatedAt: v.number(),
    revision: v.number(),
    updatedBy: v.string(),
    members: v.array(memberValidator),
    spotifyTargets: v.array(targetValidator),
  }),
  v.null(),
);

async function readPartyState(
  ctx: QueryCtx,
  party: Doc<"parties">,
  clientId: string,
  userId: Id<"users"> | null,
  guestId?: Id<"partyGuests">,
) {
  const [playback, queueDoc, memberDocs, targetDocs, guestDocs] =
    await Promise.all([
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
      ctx.db
        .query("partyGuests")
        .withIndex("by_party", (q) => q.eq("partyId", party._id))
        .take(MAX_MEMBERS),
    ]);

  const missingUserIds = [
    ...memberDocs
      .filter((member) => !member.userName)
      .map((member) => member.userId),
    ...targetDocs
      .filter((target) => !target.userName)
      .map((target) => target.userId),
  ];
  const missingAccountIds = targetDocs
    .filter((target) => !target.accountName)
    .map((target) => target.accountId);
  const [usersById, accountsById] = await Promise.all([
    loadDocsById(ctx, missingUserIds),
    loadDocsById(ctx, missingAccountIds),
  ]);

  const members = memberDocs.map((member) => ({
    _id: member._id,
    clientId: member.clientId,
    deviceLabel: member.deviceLabel,
    userName: member.userName ?? nameFromUser(usersById.get(member.userId)),
    isSelf: member.clientId === clientId,
    isHost: member.userId === party.hostUserId,
    lastSeenAt: member.lastSeenAt,
  }));

  const spotifyTargets = targetDocs.map((target) => ({
    _id: target._id,
    accountId: target.accountId,
    accountName:
      target.accountName ??
      accountsById.get(target.accountId)?.displayName ??
      "Spotify account",
    userName: target.userName ?? nameFromUser(usersById.get(target.userId)),
    isSelf: target.userId === userId,
    enabled: target.enabled,
    deviceId: target.deviceId ?? null,
    deviceName: target.deviceName ?? null,
    lastError: target.lastError ?? null,
  }));

  return {
    partyId: party._id,
    code: party.code,
    isHost: party.hostUserId === userId,
    track: playback?.track ?? null,
    queue: queueDoc?.tracks ?? [],
    queueIndex: playback?.queueIndex ?? -1,
    isPlaying: playback?.isPlaying ?? false,
    positionMs: playback?.positionMs ?? 0,
    positionUpdatedAt: playback?.positionUpdatedAt ?? playback?.updatedAt ?? 0,
    revision: playback?.revision ?? 0,
    updatedBy: playback?.updatedBy ?? "",
    members: [
      ...members,
      ...guestDocs.map((guest) => ({
        _id: guest._id,
        clientId: guest._id,
        deviceLabel: guest.deviceLabel,
        userName: guest.userName,
        isSelf: guest._id === guestId,
        isHost: false,
        lastSeenAt: guest.lastSeenAt,
      })),
    ],
    spotifyTargets: userId ? spotifyTargets : [],
  };
}

export const getState = query({
  args: { clientId: v.string() },
  returns: partyStateValidator,
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

    return readPartyState(ctx, party, args.clientId, userId);
  },
});

export const getGuestState = query({
  args: { guestToken: v.string() },
  returns: partyStateValidator,
  handler: async (ctx, { guestToken }) => {
    const guest = await findGuest(ctx, guestToken);
    if (!guest) return null;
    const party = await ctx.db.get(guest.partyId);
    if (!party || party.closedAt !== undefined) return null;
    return readPartyState(ctx, party, guest._id, null, guest._id);
  },
});

export const joinGuest = mutation({
  args: { code: v.string(), guestToken: v.string(), deviceLabel: v.string() },
  returns: v.object({ partyId: v.id("parties"), code: v.string() }),
  handler: async (ctx, args) => {
    if (!isValidPartyCode(args.code))
      throw new ConvexError("That party code doesn't look right");
    const code = normalizePartyCode(args.code);
    const party = await ctx.db
      .query("parties")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!party || party.closedAt !== undefined)
      throw new ConvexError("No active party with that code");
    await requireRecentHost(ctx, party);
    const existing = await findGuest(ctx, args.guestToken);
    if (existing?.partyId === party._id) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return { partyId: party._id, code };
    }
    if ((await pruneStaleMembers(ctx, party._id)) >= MAX_MEMBERS)
      throw new ConvexError("This party is full");
    if (existing) {
      await ctx.db.delete(existing._id);
      await closePartyIfEmpty(ctx, existing.partyId);
    }
    const now = Date.now();
    await ctx.db.insert("partyGuests", {
      partyId: party._id,
      tokenHash: await guestTokenHash(args.guestToken),
      deviceLabel: args.deviceLabel.slice(0, 100),
      userName: `Guest ${Math.floor(1000 + Math.random() * 9000)}`,
      lastSeenAt: now,
      joinedAt: now,
    });
    await ensurePolling(ctx, party);
    return { partyId: party._id, code };
  },
});

export const leaveGuest = mutation({
  args: { guestToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { guestToken }) => {
    const guest = await findGuest(ctx, guestToken);
    if (guest) {
      await ctx.db.delete(guest._id);
      await closePartyIfEmpty(ctx, guest.partyId);
    }
    return null;
  },
});

export const heartbeatGuest = mutation({
  args: { guestToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { guestToken }) => {
    const guest = await findGuest(ctx, guestToken);
    if (!guest) return null;
    const party = await ctx.db.get(guest.partyId);
    if (!party || party.closedAt !== undefined) return null;
    const now = Date.now();
    if (now - guest.lastSeenAt >= HEARTBEAT_WRITE_MIN_INTERVAL_MS) {
      await ctx.db.patch(guest._id, { lastSeenAt: now });
    }
    await ensurePolling(ctx, party);
    return null;
  },
});

export const create = mutation({
  args: { clientId: v.string(), deviceLabel: v.string() },
  returns: v.object({ partyId: v.id("parties"), code: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Must be signed in to start a party");
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
      throw new ConvexError("Could not allocate a party code. Try again.");
    }

    const now = Date.now();
    const user = await ctx.db.get(userId);
    const partyId = await ctx.db.insert("parties", {
      code,
      hostUserId: userId,
      pollRunning: false,
      pollGeneration: 0,
      expiryScheduled: true,
      createdAt: now,
    });
    await ctx.db.insert("partyMembers", {
      partyId,
      userId,
      clientId: args.clientId,
      deviceLabel: args.deviceLabel,
      lastSeenAt: now,
      joinedAt: now,
      userName: nameFromUser(user),
    });
    await ctx.db.insert("partyPlayback", {
      partyId,
      queueIndex: -1,
      isPlaying: false,
      positionMs: 0,
      positionUpdatedAt: now,
      revision: 0,
      updatedBy: `member:${args.clientId}`,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      MEMBER_STALE_WINDOW_MS,
      internal.party.sweepParty,
      { partyId },
    );
    return { partyId, code };
  },
});

export const join = mutation({
  args: { code: v.string(), clientId: v.string(), deviceLabel: v.string() },
  returns: v.object({ partyId: v.id("parties"), code: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Must be signed in to join a party");
    }
    if (!isValidPartyCode(args.code)) {
      throw new ConvexError("That party code doesn't look right");
    }
    const code = normalizePartyCode(args.code);
    const party = await ctx.db
      .query("parties")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!party || party.closedAt !== undefined) {
      throw new ConvexError("No active party with that code");
    }

    await requireRecentHost(ctx, party);
    const existing = await findMembership(ctx, userId, args.clientId);
    if (existing?.partyId === party._id) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return { partyId: party._id, code: party.code };
    }
    await leaveCurrentParty(ctx, userId, args.clientId);

    const remaining = await pruneStaleMembers(ctx, party._id);
    if (remaining >= MAX_MEMBERS) {
      throw new ConvexError("This party is full");
    }

    const now = Date.now();
    const user = await ctx.db.get(userId);
    await ctx.db.insert("partyMembers", {
      partyId: party._id,
      userId,
      clientId: args.clientId,
      deviceLabel: args.deviceLabel,
      lastSeenAt: now,
      joinedAt: now,
      userName: nameFromUser(user),
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
    const now = Date.now();
    if (now - member.lastSeenAt >= HEARTBEAT_WRITE_MIN_INTERVAL_MS) {
      await ctx.db.patch(member._id, { lastSeenAt: now });
    }

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
    guestToken: v.optional(v.string()),
    track: partyTrackValidator,
    queueIndex: v.number(),
    /** Only sent when the client's queue actually changed. */
    queue: v.optional(v.array(partyTrackValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member, party } = await requirePlaybackMembership(
      ctx,
      args.clientId,
      args.guestToken,
    );

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
      updatedBy: `member:${"clientId" in member ? member.clientId : member._id}`,
      track: args.track,
      queueIndex: args.queueIndex,
      isPlaying: true,
      positionMs: 0,
    });
    await ensurePolling(ctx, party);
    return null;
  },
});

/** Queue edits do not restart the song or change the party's play/pause state. */
export const setQueue = mutation({
  args: {
    clientId: v.string(),
    guestToken: v.optional(v.string()),
    tracks: v.array(partyTrackValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requirePlaybackMembership(
      ctx,
      args.clientId,
      args.guestToken,
    );
    const tracks = trimQueue(args.tracks);
    const existing = await getQueue(ctx, member.partyId);
    if (existing)
      await ctx.db.patch(existing._id, { tracks, updatedAt: Date.now() });
    else
      await ctx.db.insert("partyQueue", {
        partyId: member.partyId,
        tracks,
        updatedAt: Date.now(),
      });
    return null;
  },
});

export const setPlaying = mutation({
  args: {
    guestToken: v.optional(v.string()),
    clientId: v.string(),
    isPlaying: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requirePlaybackMembership(
      ctx,
      args.clientId,
      args.guestToken,
    );
    const playback = await getPlayback(ctx, member.partyId);
    if (playback && playback.isPlaying === args.isPlaying) {
      return null;
    }
    await commitPlayback(ctx, {
      partyId: member.partyId,
      updatedBy: `member:${"clientId" in member ? member.clientId : member._id}`,
      isPlaying: args.isPlaying,
    });
    return null;
  },
});

/** Reports a seek. Ignored when the offset is still within the 5s grace window. */
export const setPosition = mutation({
  args: {
    guestToken: v.optional(v.string()),
    clientId: v.string(),
    positionMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requirePlaybackMembership(
      ctx,
      args.clientId,
      args.guestToken,
    );
    const playback = await getPlayback(ctx, member.partyId);
    if (!playback?.track) {
      return null;
    }
    const now = Date.now();
    const estimated = estimatedPositionMs({
      positionMs: playback.positionMs ?? 0,
      positionUpdatedAt: playback.positionUpdatedAt ?? now,
      isPlaying: playback.isPlaying,
      now,
      durationMs: playback.track.durationMs,
    });
    const nextPosition = Math.max(
      0,
      Math.min(args.positionMs, playback.track.durationMs || args.positionMs),
    );
    if (!shouldSyncPosition(nextPosition, estimated)) {
      return null;
    }
    await commitPlayback(ctx, {
      partyId: member.partyId,
      updatedBy: `member:${"clientId" in member ? member.clientId : member._id}`,
      positionMs: nextPosition,
    });
    return null;
  },
});

export const setSpotifyTarget = mutation({
  args: {
    clientId: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, member, party } = await requireMembership(
      ctx,
      args.clientId,
    );
    const account = await ctx.db
      .query("spotifyAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) {
      throw new ConvexError("Connect a Spotify account first");
    }

    const existing = await ctx.db
      .query("partySpotifyTargets")
      .withIndex("by_party_and_account", (q) =>
        q.eq("partyId", member.partyId).eq("accountId", account._id),
      )
      .unique();

    const now = Date.now();

    const user = await ctx.db.get(userId);
    const userName = nameFromUser(user);
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        lastError: undefined,
        updatedAt: now,
        accountName: account.displayName,
        userName,
      });
    } else {
      await ctx.db.insert("partySpotifyTargets", {
        partyId: member.partyId,
        accountId: account._id,
        userId,
        enabled: args.enabled,
        lastPushedAt: 0,
        updatedAt: now,
        accountName: account.displayName,
        userName,
      });
    }

    if (args.enabled) {
      // Watch Spotify for track/position and allow JedFlix pause/play to reach it.
      await ensurePolling(ctx, party);
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

    const guests = await ctx.db
      .query("partyGuests")
      .withIndex("by_party", (q) => q.eq("partyId", args.partyId))
      .take(MAX_MEMBERS);
    return {
      party,
      playback,
      queue: queueDoc?.tracks ?? [],
      targets: targets.filter((target) => target.enabled),
      // The caller is an action, so it decides what counts as stale.
      lastMemberSeenAt: [...members, ...guests].reduce(
        (latest, member) => Math.max(latest, member.lastSeenAt),
        0,
      ),
    };
  },
});

/** Drops members that stopped sending heartbeats and closes an empty party. */
/** Expires guests and ends a party once every host device has been offline for 5 minutes. */
export const sweepParty = internalMutation({
  args: { partyId: v.id("parties") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const party = await ctx.db.get(args.partyId);
    if (!party || party.closedAt !== undefined) return null;
    await pruneStaleMembers(ctx, args.partyId);
    const members = await ctx.db
      .query("partyMembers")
      .withIndex("by_party", (q) => q.eq("partyId", args.partyId))
      .take(MAX_MEMBERS);
    const lastHostSeenAt = members.reduce(
      (latest, member) =>
        member.userId === party.hostUserId
          ? Math.max(latest, member.lastSeenAt)
          : latest,
      0,
    );
    const remainingMs = lastHostSeenAt + MEMBER_STALE_WINDOW_MS - Date.now();
    if (remainingMs <= 0) {
      await ctx.db.patch(party._id, {
        closedAt: Date.now(),
        pollRunning: false,
      });
    } else {
      await ctx.scheduler.runAfter(
        remainingMs,
        internal.party.sweepParty,
        args,
      );
    }
    return null;
  },
});

export const recordPlayPush = internalMutation({
  args: {
    targetId: v.id("partySpotifyTargets"),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target) {
      return null;
    }
    await ctx.db.patch(args.targetId, {
      lastPushedAt: Date.now(),
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
    if (
      target.lastObservedTrackId === args.trackId &&
      target.lastError === args.error
    ) {
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
    positionMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const party = await ctx.db.get(args.partyId);
    if (!party || party.closedAt !== undefined) {
      return null;
    }
    const queueDoc = await getQueue(ctx, args.partyId);
    let queueIndex = -1;
    if (args.track) {
      const existingIndex =
        queueDoc?.tracks.findIndex((item) => item.id === args.track?.id) ?? -1;
      if (existingIndex >= 0) {
        queueIndex = existingIndex;
      } else {
        // Spotify introduced a track outside the mirrored queue. Put it at the
        // front so JedFlix clients play that song instead of falling back to
        // whatever was previously first in the queue.
        const tracks = trimQueue([
          args.track,
          ...(queueDoc?.tracks ?? []).filter(
            (item) => item.id !== args.track?.id,
          ),
        ]);
        if (queueDoc) {
          await ctx.db.patch(queueDoc._id, { tracks, updatedAt: Date.now() });
        } else {
          await ctx.db.insert("partyQueue", {
            partyId: args.partyId,
            tracks,
            updatedAt: Date.now(),
          });
        }
        queueIndex = 0;
      }
    }

    await commitPlayback(ctx, {
      partyId: args.partyId,
      updatedBy: `spotify:${args.accountId}`,
      track: args.track,
      queueIndex,
      isPlaying: args.isPlaying,
      positionMs: args.positionMs,
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
  const party = await ctx.db.get(partyId);
  if (party?.hostUserId === userId) {
    await ctx.db.patch(partyId, { closedAt: Date.now(), pollRunning: false });
  }
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
