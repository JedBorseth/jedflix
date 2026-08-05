import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  LIBRARY_MUTATION_BATCH_SIZE,
  MAX_PLAYLIST_TRACKS,
  MAX_PLAYLISTS,
  musicTrackValidator,
  normalizeTrack,
  type MusicTrack,
} from "./musicTrack";

const playlistSummaryValidator = v.object({
  _id: v.id("playlists"),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  trackCount: v.number(),
  coverImageUrl: v.union(v.string(), v.null()),
});

const playlistTrackReturnValidator = v.object({
  _id: v.id("playlistTracks"),
  id: v.string(),
  title: v.string(),
  artists: v.array(v.string()),
  artistIds: v.optional(v.array(v.string())),
  albumName: v.string(),
  albumId: v.optional(v.string()),
  imageUrl: v.string(),
  durationMs: v.number(),
  addedAt: v.number(),
  position: v.number(),
});

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Must be signed in to manage playlists");
  }
  return userId;
}

async function requireOwnedPlaylist(
  ctx: QueryCtx | MutationCtx,
  playlistId: Id<"playlists">,
  userId: Id<"users">,
) {
  const playlist = await ctx.db.get(playlistId);
  if (!playlist || playlist.userId !== userId) {
    throw new Error("Playlist not found");
  }
  return playlist;
}

async function resolveTrackCount(
  ctx: MutationCtx,
  playlistId: Id<"playlists">,
  playlist: { trackCount?: number },
): Promise<number> {
  if (playlist.trackCount !== undefined) {
    return playlist.trackCount;
  }
  // Legacy playlists created before denormalized counts existed.
  const tracks = await ctx.db
    .query("playlistTracks")
    .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
    .take(MAX_PLAYLIST_TRACKS);
  return tracks.length;
}

export const list = query({
  args: {},
  returns: v.array(playlistSummaryValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const playlists = await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_PLAYLISTS);

    const summaries = await Promise.all(
      playlists.map(async (playlist) => {
        let trackCount = playlist.trackCount;
        let coverImageUrl = playlist.coverImageUrl ?? null;
        if (trackCount === undefined) {
          const tracks = await ctx.db
            .query("playlistTracks")
            .withIndex("by_playlist_and_position", (q) =>
              q.eq("playlistId", playlist._id),
            )
            .take(MAX_PLAYLIST_TRACKS);
          trackCount = tracks.length;
          coverImageUrl = tracks[0]?.imageUrl ?? null;
        }
        return {
          _id: playlist._id,
          name: playlist.name,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
          trackCount,
          coverImageUrl,
        };
      }),
    );

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: { playlistId: v.id("playlists") },
  returns: v.union(
    v.object({
      _id: v.id("playlists"),
      name: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      trackCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist || playlist.userId !== userId) {
      return null;
    }

    let trackCount = playlist.trackCount;
    if (trackCount === undefined) {
      const tracks = await ctx.db
        .query("playlistTracks")
        .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
        .take(MAX_PLAYLIST_TRACKS);
      trackCount = tracks.length;
    }

    return {
      _id: playlist._id,
      name: playlist.name,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      trackCount,
    };
  },
});

export const listTracks = query({
  args: { playlistId: v.id("playlists") },
  returns: v.array(playlistTrackReturnValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist || playlist.userId !== userId) {
      return [];
    }

    // Prefer position index for large playlists; fall back is not needed.
    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_and_position", (q) =>
        q.eq("playlistId", playlist._id),
      )
      .take(MAX_PLAYLIST_TRACKS);

    return tracks.map((item) => ({
      _id: item._id,
      id: item.id,
      title: item.title,
      artists: item.artists,
      artistIds: item.artistIds,
      albumName: item.albumName,
      albumId: item.albumId,
      imageUrl: item.imageUrl,
      durationMs: item.durationMs,
      addedAt: item.addedAt,
      position: item.position,
    }));
  },
});

/** Paginated track list for large playlists (thousands of songs). */
export const listTracksPage = query({
  args: {
    playlistId: v.id("playlists"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist || playlist.userId !== userId) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_and_position", (q) =>
        q.eq("playlistId", playlist._id),
      )
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((item) => ({
        _id: item._id,
        id: item.id,
        title: item.title,
        artists: item.artists,
        artistIds: item.artistIds,
        albumName: item.albumName,
        albumId: item.albumId,
        imageUrl: item.imageUrl,
        durationMs: item.durationMs,
        addedAt: item.addedAt,
        position: item.position,
      })),
    };
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.id("playlists"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Playlist name is required");
    }
    if (name.length > 100) {
      throw new Error("Playlist name must be 100 characters or fewer");
    }

    const existing = await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_PLAYLISTS + 1);
    if (existing.length >= MAX_PLAYLISTS) {
      throw new Error(`Playlist limit reached (${MAX_PLAYLISTS})`);
    }

    const now = Date.now();
    return await ctx.db.insert("playlists", {
      userId,
      name,
      trackCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: {
    playlistId: v.id("playlists"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedPlaylist(ctx, args.playlistId, userId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Playlist name is required");
    }
    if (name.length > 100) {
      throw new Error("Playlist name must be 100 characters or fewer");
    }

    await ctx.db.patch(args.playlistId, {
      name,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { playlistId: v.id("playlists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedPlaylist(ctx, args.playlistId, userId);

    // Delete tracks in batches so large imports stay within transaction limits.
    await ctx.scheduler.runAfter(0, internal.playlists.deleteTracksBatch, {
      playlistId: args.playlistId,
      userId,
    });
    return null;
  },
});

export const deleteTracksBatch = internalMutation({
  args: {
    playlistId: v.id("playlists"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist || playlist.userId !== args.userId) {
      return null;
    }

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.playlistId))
      .take(LIBRARY_MUTATION_BATCH_SIZE);

    if (tracks.length === 0) {
      await ctx.db.delete(args.playlistId);
      return null;
    }

    for (const track of tracks) {
      await ctx.db.delete(track._id);
    }

    await ctx.scheduler.runAfter(0, internal.playlists.deleteTracksBatch, {
      playlistId: args.playlistId,
      userId: args.userId,
    });
    return null;
  },
});

export const addTrack = mutation({
  args: {
    playlistId: v.id("playlists"),
    track: musicTrackValidator,
  },
  returns: v.object({ added: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const playlist = await requireOwnedPlaylist(ctx, args.playlistId, userId);

    const track = normalizeTrack(args.track);
    const existing = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_and_track", (q) =>
        q.eq("playlistId", args.playlistId).eq("id", track.id),
      )
      .unique();

    if (existing) {
      return { added: false };
    }

    const count = await resolveTrackCount(ctx, args.playlistId, playlist);
    if (count >= MAX_PLAYLIST_TRACKS) {
      throw new Error(`Playlist track limit reached (${MAX_PLAYLIST_TRACKS})`);
    }

    const now = Date.now();
    await ctx.db.insert("playlistTracks", {
      playlistId: args.playlistId,
      userId,
      ...track,
      addedAt: now,
      position: count,
    });
    await ctx.db.patch(args.playlistId, {
      trackCount: count + 1,
      coverImageUrl: playlist.coverImageUrl ?? (track.imageUrl || undefined),
      updatedAt: now,
    });
    return { added: true };
  },
});

/**
 * Bulk insert for Spotify imports. Dedupes by Spotify track id, appends in
 * order, and updates denormalized playlist metadata. Caller must already own
 * the playlist (used from internal import mutations).
 */
export const addTracksBatch = internalMutation({
  args: {
    playlistId: v.id("playlists"),
    userId: v.id("users"),
    tracks: v.array(musicTrackValidator),
  },
  returns: v.object({
    added: v.number(),
    skipped: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist || playlist.userId !== args.userId) {
      throw new Error("Playlist not found");
    }

    let count = await resolveTrackCount(ctx, args.playlistId, playlist);
    let added = 0;
    let skipped = 0;
    let truncated = false;
    let coverImageUrl = playlist.coverImageUrl;
    const now = Date.now();

    for (const raw of args.tracks) {
      if (count >= MAX_PLAYLIST_TRACKS) {
        truncated = true;
        skipped += 1;
        continue;
      }

      let track: MusicTrack;
      try {
        track = normalizeTrack(raw);
      } catch {
        skipped += 1;
        continue;
      }

      const existing = await ctx.db
        .query("playlistTracks")
        .withIndex("by_playlist_and_track", (q) =>
          q.eq("playlistId", args.playlistId).eq("id", track.id),
        )
        .unique();
      if (existing) {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("playlistTracks", {
        playlistId: args.playlistId,
        userId: args.userId,
        ...track,
        addedAt: now,
        position: count,
      });
      if (!coverImageUrl && track.imageUrl) {
        coverImageUrl = track.imageUrl;
      }
      count += 1;
      added += 1;
    }

    if (added > 0) {
      await ctx.db.patch(args.playlistId, {
        trackCount: count,
        coverImageUrl,
        updatedAt: now,
      });
    }

    return { added, skipped, truncated };
  },
});

export const removeTrack = mutation({
  args: {
    playlistId: v.id("playlists"),
    trackId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const playlist = await requireOwnedPlaylist(ctx, args.playlistId, userId);

    const trackId = args.trackId.trim();
    if (!trackId) {
      throw new Error("Track id is required");
    }

    const existing = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_and_track", (q) =>
        q.eq("playlistId", args.playlistId).eq("id", trackId),
      )
      .unique();

    if (existing) {
      const count = await resolveTrackCount(ctx, args.playlistId, playlist);
      await ctx.db.delete(existing._id);
      const nextCount = Math.max(0, count - 1);
      const patch: {
        trackCount: number;
        updatedAt: number;
        coverImageUrl?: string;
      } = {
        trackCount: nextCount,
        updatedAt: Date.now(),
      };
      if (playlist.coverImageUrl === existing.imageUrl) {
        const nextCover = await ctx.db
          .query("playlistTracks")
          .withIndex("by_playlist_and_position", (q) =>
            q.eq("playlistId", args.playlistId),
          )
          .take(1);
        patch.coverImageUrl = nextCover[0]?.imageUrl;
      }
      await ctx.db.patch(args.playlistId, patch);
    }
    return null;
  },
});

/** Create a playlist owned by userId (import path; no auth check). */
export const createForImport = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    spotifyPlaylistId: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
  },
  returns: v.id("playlists"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(MAX_PLAYLISTS + 1);
    if (existing.length >= MAX_PLAYLISTS) {
      throw new Error(`Playlist limit reached (${MAX_PLAYLISTS})`);
    }

    const now = Date.now();
    return await ctx.db.insert("playlists", {
      userId: args.userId,
      name: args.name.trim() || "Imported playlist",
      trackCount: 0,
      coverImageUrl: args.coverImageUrl,
      spotifyPlaylistId: args.spotifyPlaylistId,
      createdAt: now,
      updatedAt: now,
    });
  },
});
