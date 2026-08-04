import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  MAX_PLAYLIST_TRACKS,
  MAX_PLAYLISTS,
  musicTrackValidator,
  normalizeTrack,
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
        const tracks = await ctx.db
          .query("playlistTracks")
          .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
          .take(MAX_PLAYLIST_TRACKS);
        const ordered = tracks.sort((a, b) => a.position - b.position);
        return {
          _id: playlist._id,
          name: playlist.name,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
          trackCount: ordered.length,
          coverImageUrl: ordered[0]?.imageUrl ?? null,
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

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
      .take(MAX_PLAYLIST_TRACKS);

    return {
      _id: playlist._id,
      name: playlist.name,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      trackCount: tracks.length,
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

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
      .take(MAX_PLAYLIST_TRACKS);

    return tracks
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
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

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.playlistId))
      .take(MAX_PLAYLIST_TRACKS);
    for (const track of tracks) {
      await ctx.db.delete(track._id);
    }

    await ctx.db.delete(args.playlistId);
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
    await requireOwnedPlaylist(ctx, args.playlistId, userId);

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

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.playlistId))
      .take(MAX_PLAYLIST_TRACKS + 1);
    if (tracks.length >= MAX_PLAYLIST_TRACKS) {
      throw new Error(`Playlist track limit reached (${MAX_PLAYLIST_TRACKS})`);
    }

    const maxPosition = tracks.reduce(
      (max, item) => Math.max(max, item.position),
      -1,
    );
    const now = Date.now();
    await ctx.db.insert("playlistTracks", {
      playlistId: args.playlistId,
      userId,
      ...track,
      addedAt: now,
      position: maxPosition + 1,
    });
    await ctx.db.patch(args.playlistId, { updatedAt: now });
    return { added: true };
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
    await requireOwnedPlaylist(ctx, args.playlistId, userId);

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
      await ctx.db.delete(existing._id);
      await ctx.db.patch(args.playlistId, { updatedAt: Date.now() });
    }
    return null;
  },
});
