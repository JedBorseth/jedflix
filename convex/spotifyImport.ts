/**
 * Spotify → JedFlix library import.
 *
 * Long-running: processes playlists / liked songs in Spotify page-sized batches
 * (50 tracks) via scheduled internal actions so a 10k+ library stays within
 * Convex mutation limits and survives client navigation.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { IMPORT_TRACK_BATCH_SIZE } from "./musicTrack";
import type { MusicTrack } from "./musicTrack";
import { spotifyTrackToPartyTrack } from "./partyModel";
import { ensureAccessToken } from "./spotify";
import {
  describeSpotifyError,
  getLikedTracksPage,
  getLikedTracksTotal,
  getPlaylistTracksPage,
  hasImportScopes,
  listUserPlaylists,
  SpotifyApiError,
  type SpotifyPlaylistSummary,
} from "./spotifyApi";

const MAX_PLAYLISTS_PER_IMPORT = 50;
/** Brief pause after rate-limit / between heavy batches. */
const RETRY_DELAY_MS = 2_000;
const BATCH_DELAY_MS = 0;

const jobProgressValidator = v.union(
  v.object({
    _id: v.id("spotifyImportJobs"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    totalItems: v.number(),
    completedItems: v.number(),
    importedTracks: v.number(),
    skippedTracks: v.number(),
    currentLabel: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  v.null(),
);

const playlistPickValidator = v.object({
  id: v.string(),
  name: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  trackCount: v.number(),
  ownerName: v.union(v.string(), v.null()),
  isOwner: v.boolean(),
});

function toMusicTrack(raw: unknown): MusicTrack | null {
  const mapped = spotifyTrackToPartyTrack(raw);
  if (!mapped) {
    return null;
  }
  // Local files / podcasts from Spotify come through without a normal track id.
  if (!mapped.id || mapped.id.length < 10) {
    return null;
  }
  return mapped;
}

async function requireLinkedAccount(ctx: ActionCtx) {
  const account = await ctx.runQuery(internal.spotify.getMyAccountInternal, {});
  if (!account) {
    throw new Error("Connect Spotify in Settings before importing playlists.");
  }
  if (!hasImportScopes(account.scope)) {
    throw new Error(
      "Spotify needs library permission. Disconnect and reconnect Spotify to grant playlist access.",
    );
  }
  return account;
}

/** Active or most recent import job for the toaster. */
export const getActiveJob = query({
  args: {},
  returns: jobProgressValidator,
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const jobs = await ctx.db
      .query("spotifyImportJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);

    const running = jobs.find((job) => job.status === "running");
    const job = running ?? jobs[0];
    if (!job) {
      return null;
    }

    // Hide completed/failed jobs after a short window so the toast can dismiss.
    if (job.status !== "running" && Date.now() - job.updatedAt > 60_000) {
      return null;
    }

    return {
      _id: job._id,
      status: job.status,
      totalItems: job.totalItems,
      completedItems: job.completedItems,
      importedTracks: job.importedTracks,
      skippedTracks: job.skippedTracks,
      currentLabel: job.currentLabel ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  },
});

/** Fetch Spotify playlists (+ liked count) for the import picker. */
export const listLibraryForImport = action({
  args: {},
  returns: v.object({
    likedSongs: v.object({
      trackCount: v.number(),
    }),
    playlists: v.array(playlistPickValidator),
  }),
  handler: async (ctx) => {
    const account = await requireLinkedAccount(ctx);
    const accessToken = await ensureAccessToken(ctx, account._id);

    const playlists: Array<SpotifyPlaylistSummary & { isOwner: boolean }> = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const result = await listUserPlaylists(accessToken, { limit: 50, offset });
      for (const item of result.items) {
        playlists.push({
          ...item,
          isOwner:
            item.ownerId === account.spotifyUserId || item.collaborative,
        });
      }
      if (result.nextOffset === null) {
        break;
      }
      offset = result.nextOffset;
    }

    let likedTotal = 0;
    try {
      likedTotal = await getLikedTracksTotal(accessToken);
    } catch (error) {
      // Liked songs may fail if scope is missing mid-flight; surface via playlists only.
      if (!(error instanceof SpotifyApiError && error.status === 403)) {
        throw error;
      }
    }

    return {
      likedSongs: { trackCount: likedTotal },
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        imageUrl: playlist.imageUrl,
        trackCount: playlist.trackCount,
        ownerName: playlist.ownerName,
        isOwner: playlist.isOwner,
      })),
    };
  },
});

/**
 * Start an import. Creates a job + per-playlist items, then schedules the
 * first batch. Progress is observed via `getActiveJob`.
 */
export const startImport = action({
  args: {
    importLikedSongs: v.boolean(),
    playlists: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        imageUrl: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  },
  returns: v.id("spotifyImportJobs"),
  handler: async (ctx, args): Promise<Id<"spotifyImportJobs">> => {
    await requireLinkedAccount(ctx);

    if (!args.importLikedSongs && args.playlists.length === 0) {
      throw new Error("Select Liked Songs and/or at least one playlist.");
    }
    if (args.playlists.length > MAX_PLAYLISTS_PER_IMPORT) {
      throw new Error(
        `You can import at most ${MAX_PLAYLISTS_PER_IMPORT} playlists at a time.`,
      );
    }

    const jobId: Id<"spotifyImportJobs"> = await ctx.runMutation(
      internal.spotifyImport.createJob,
      {
        importLikedSongs: args.importLikedSongs,
        playlists: args.playlists.map((playlist) => ({
          id: playlist.id.trim(),
          name: playlist.name.trim() || "Playlist",
          imageUrl: playlist.imageUrl ?? null,
        })),
      },
    );

    await ctx.scheduler.runAfter(0, internal.spotifyImport.processNextBatch, {
      jobId,
    });

    return jobId;
  },
});

export const dismissJob = action({
  args: { jobId: v.id("spotifyImportJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.spotifyImport.markDismissed, {
      jobId: args.jobId,
    });
    return null;
  },
});

// --- Internal ---------------------------------------------------------------

export const createJob = internalMutation({
  args: {
    importLikedSongs: v.boolean(),
    playlists: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        imageUrl: v.union(v.string(), v.null()),
      }),
    ),
  },
  returns: v.id("spotifyImportJobs"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Must be signed in to import playlists");
    }

    const existing = await ctx.db
      .query("spotifyImportJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(10);
    if (existing.some((job) => job.status === "running")) {
      throw new Error("An import is already running. Wait for it to finish.");
    }

    const now = Date.now();
    const items: Array<{
      kind: "liked_songs" | "playlist";
      spotifyPlaylistId?: string;
      name: string;
      imageUrl?: string;
      sortOrder: number;
    }> = [];

    if (args.importLikedSongs) {
      items.push({
        kind: "liked_songs",
        name: "Liked Songs",
        sortOrder: 0,
      });
    }

    for (const playlist of args.playlists) {
      if (!playlist.id) {
        continue;
      }
      items.push({
        kind: "playlist",
        spotifyPlaylistId: playlist.id,
        name: playlist.name,
        imageUrl: playlist.imageUrl ?? undefined,
        sortOrder: items.length,
      });
    }

    if (items.length === 0) {
      throw new Error("Select Liked Songs and/or at least one playlist.");
    }

    const jobId = await ctx.db.insert("spotifyImportJobs", {
      userId,
      status: "running",
      totalItems: items.length,
      completedItems: 0,
      importedTracks: 0,
      skippedTracks: 0,
      currentLabel: items[0]?.name,
      createdAt: now,
      updatedAt: now,
    });

    for (const item of items) {
      await ctx.db.insert("spotifyImportItems", {
        jobId,
        userId,
        kind: item.kind,
        spotifyPlaylistId: item.spotifyPlaylistId,
        name: item.name,
        imageUrl: item.imageUrl,
        status: "pending",
        spotifyOffset: 0,
        imported: 0,
        skipped: 0,
        sortOrder: item.sortOrder,
      });
    }

    return jobId;
  },
});

export const markDismissed = internalMutation({
  args: { jobId: v.id("spotifyImportJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) {
      return null;
    }
    // Push updatedAt into the past so getActiveJob hides it immediately.
    await ctx.db.patch(args.jobId, { updatedAt: Date.now() - 120_000 });
    return null;
  },
});

export const getJobSnapshot = internalQuery({
  args: { jobId: v.id("spotifyImportJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return null;
    }
    const items = await ctx.db
      .query("spotifyImportItems")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PLAYLISTS_PER_IMPORT + 1);
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    return { job, items };
  },
});

export const beginItem = internalMutation({
  args: {
    itemId: v.id("spotifyImportItems"),
    jedflixPlaylistId: v.optional(v.id("playlists")),
    total: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      return null;
    }
    await ctx.db.patch(args.itemId, {
      status: "running",
      jedflixPlaylistId: args.jedflixPlaylistId ?? item.jedflixPlaylistId,
      total: args.total ?? item.total,
    });
    await ctx.db.patch(item.jobId, {
      currentLabel: item.name,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordBatchProgress = internalMutation({
  args: {
    itemId: v.id("spotifyImportItems"),
    added: v.number(),
    skipped: v.number(),
    nextOffset: v.union(v.number(), v.null()),
    total: v.optional(v.number()),
    truncated: v.boolean(),
  },
  returns: v.object({
    done: v.boolean(),
    itemComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      return { done: true, itemComplete: true };
    }
    const job = await ctx.db.get(item.jobId);
    if (!job || job.status !== "running") {
      return { done: true, itemComplete: true };
    }

    const imported = item.imported + args.added;
    const skipped = item.skipped + args.skipped;
    const itemComplete = args.nextOffset === null || args.truncated;

    await ctx.db.patch(args.itemId, {
      imported,
      skipped,
      spotifyOffset: args.nextOffset ?? item.spotifyOffset,
      total: args.total ?? item.total,
      status: itemComplete ? "completed" : "running",
      ...(args.truncated
        ? { error: "Reached JedFlix track limit for this playlist." }
        : {}),
    });

    const completedItems = job.completedItems + (itemComplete ? 1 : 0);
    const jobDone = completedItems >= job.totalItems;
    await ctx.db.patch(item.jobId, {
      importedTracks: job.importedTracks + args.added,
      skippedTracks: job.skippedTracks + args.skipped,
      completedItems,
      status: jobDone ? "completed" : "running",
      currentLabel: itemComplete
        ? jobDone
          ? undefined
          : job.currentLabel
        : item.name,
      updatedAt: Date.now(),
    });

    return { done: jobDone, itemComplete };
  },
});

export const failItemAndContinue = internalMutation({
  args: {
    jobId: v.id("spotifyImportJobs"),
    itemId: v.id("spotifyImportItems"),
    error: v.string(),
  },
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    const job = await ctx.db.get(args.jobId);
    if (!item || !job) {
      return { done: true };
    }

    // Drop empty playlists created before Spotify rejected the track list.
    if (
      item.jedflixPlaylistId &&
      item.imported === 0 &&
      item.kind === "playlist"
    ) {
      const playlist = await ctx.db.get(item.jedflixPlaylistId);
      if (playlist && (playlist.trackCount ?? 0) === 0) {
        await ctx.db.delete(item.jedflixPlaylistId);
      }
    }

    await ctx.db.patch(args.itemId, {
      status: "failed",
      error: args.error,
      jedflixPlaylistId: undefined,
    });

    // Only bump completedItems if this item wasn't already counted.
    const alreadyCounted = item.status === "completed" || item.status === "failed";
    const nextCompleted = alreadyCounted ? job.completedItems : job.completedItems + 1;
    const jobDone = nextCompleted >= job.totalItems;

    await ctx.db.patch(args.jobId, {
      completedItems: nextCompleted,
      status: jobDone ? (job.importedTracks > 0 ? "completed" : "failed") : "running",
      error: jobDone && job.importedTracks === 0 ? args.error : job.error,
      updatedAt: Date.now(),
    });

    return { done: jobDone };
  },
});

export const failJob = internalMutation({
  args: {
    jobId: v.id("spotifyImportJobs"),
    itemId: v.optional(v.id("spotifyImportItems")),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.itemId) {
      await ctx.db.patch(args.itemId, {
        status: "failed",
        error: args.error,
      });
    }
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const processNextBatch = internalAction({
  args: { jobId: v.id("spotifyImportJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(internal.spotifyImport.getJobSnapshot, {
      jobId: args.jobId,
    });
    if (!snapshot || snapshot.job.status !== "running") {
      return null;
    }

    const item =
      snapshot.items.find((row) => row.status === "running") ??
      snapshot.items.find((row) => row.status === "pending");
    if (!item) {
      await ctx.runMutation(internal.spotifyImport.failJob, {
        jobId: args.jobId,
        error: "Import finished unexpectedly with no remaining items.",
      });
      return null;
    }

    const account = await ctx.runQuery(internal.spotify.getAccountByUser, {
      userId: snapshot.job.userId,
    });
    if (!account) {
      await ctx.runMutation(internal.spotifyImport.failJob, {
        jobId: args.jobId,
        itemId: item._id,
        error: "Spotify account was disconnected during import.",
      });
      return null;
    }

    try {
      const accessToken = await ensureAccessToken(ctx, account._id);

      let jedflixPlaylistId = item.jedflixPlaylistId;

      if (item.status === "pending") {
        if (item.kind === "playlist") {
          jedflixPlaylistId = await ctx.runMutation(
            internal.playlists.createForImport,
            {
              userId: snapshot.job.userId,
              name: item.name,
              spotifyPlaylistId: item.spotifyPlaylistId,
              coverImageUrl: item.imageUrl,
            },
          );
          await ctx.runMutation(internal.spotifyImport.beginItem, {
            itemId: item._id,
            jedflixPlaylistId,
          });
        } else {
          await ctx.runMutation(internal.spotifyImport.beginItem, {
            itemId: item._id,
          });
        }
      }

      const page =
        item.kind === "liked_songs"
          ? await getLikedTracksPage(
              accessToken,
              item.spotifyOffset,
              IMPORT_TRACK_BATCH_SIZE,
            )
          : await getPlaylistTracksPage(
              accessToken,
              item.spotifyPlaylistId!,
              item.spotifyOffset,
              IMPORT_TRACK_BATCH_SIZE,
            );

      const tracks: MusicTrack[] = [];
      for (const raw of page.items) {
        const track = toMusicTrack(raw);
        if (track) {
          tracks.push(track);
        }
      }

      if (item.kind === "playlist" && !jedflixPlaylistId) {
        throw new Error("Playlist was not created for import");
      }

      const writeResult =
        item.kind === "liked_songs"
          ? await ctx.runMutation(internal.likedSongs.likeTracksBatch, {
              userId: snapshot.job.userId,
              tracks,
            })
          : await ctx.runMutation(internal.playlists.addTracksBatch, {
              playlistId: jedflixPlaylistId!,
              userId: snapshot.job.userId,
              tracks,
            });

      // Tracks Spotify returned that we could not map still count as skipped.
      const unmapped = page.items.length - tracks.length;
      const progress = await ctx.runMutation(
        internal.spotifyImport.recordBatchProgress,
        {
          itemId: item._id,
          added: writeResult.added,
          skipped: writeResult.skipped + unmapped,
          nextOffset: writeResult.truncated ? null : page.nextOffset,
          total: page.total,
          truncated: writeResult.truncated,
        },
      );

      if (!progress.done) {
        await ctx.scheduler.runAfter(
          BATCH_DELAY_MS,
          internal.spotifyImport.processNextBatch,
          { jobId: args.jobId },
        );
      }
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 429) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS,
          internal.spotifyImport.processNextBatch,
          { jobId: args.jobId },
        );
        return null;
      }

      // One playlist failing (e.g. followed playlist blocked by Spotify) should
      // not abort Liked Songs / other playlists in the same job.
      const result = await ctx.runMutation(
        internal.spotifyImport.failItemAndContinue,
        {
          jobId: args.jobId,
          itemId: item._id,
          error: describeSpotifyError(error),
        },
      );
      if (!result.done) {
        await ctx.scheduler.runAfter(
          BATCH_DELAY_MS,
          internal.spotifyImport.processNextBatch,
          { jobId: args.jobId },
        );
      }
    }

    return null;
  },
});
