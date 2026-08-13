import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  externalPlayerValidator,
  mediaTypeValidator,
  streamModeValidator,
} from "@jedflix/shared";
import { musicTrackValidator } from "./musicTrack";
import { partyTrackValidator } from "./partyModel";

export default defineSchema({
  ...authTables,
  watchHistory: defineTable({
    userId: v.id("users"),
    // TMDB numeric id for movie/tv. Optional so audiobook/ebook rows can omit it.
    movieId: v.optional(v.number()),
    // Open Library work id for audiobook/ebook (e.g. OL82563W).
    workId: v.optional(v.string()),
    mediaType: mediaTypeValidator,
    progressSeconds: v.number(),
    lastWatchedAt: v.number(),
    season: v.optional(v.number()),
    episode: v.optional(v.number()),
    // Audiobook multi-file playlist index (0-based).
    fileIndex: v.optional(v.number()),
    // Ebook location: EPUB CFI or PDF page number as string.
    location: v.optional(v.string()),
    // Last audiobook stream choice for one-click listen (no catalog metadata).
    selectedStreamId: v.optional(v.string()),
    selectedStreamTitle: v.optional(v.string()),
    selectedStreamMagnet: v.optional(v.string()),
    selectedStreamAbbPostUrl: v.optional(v.string()),
    selectedStreamInfoHash: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"])
    .index("by_user_and_media_type_and_work_id", ["userId", "mediaType", "workId"]),
  myList: defineTable({
    userId: v.id("users"),
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
    mediaType: mediaTypeValidator,
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"])
    .index("by_user_and_media_type_and_work_id", ["userId", "mediaType", "workId"]),
  mediaReviews: defineTable({
    userId: v.id("users"),
    movieId: v.optional(v.number()),
    workId: v.optional(v.string()),
    mediaType: mediaTypeValidator,
    rating: v.number(),
    comment: v.string(),
    updatedAt: v.number(),
  })
    .index("by_media_type_and_movie_id", ["mediaType", "movieId"])
    .index("by_media_type_and_work_id", ["mediaType", "workId"])
    .index("by_user_and_media_type_and_movie_id", ["userId", "mediaType", "movieId"])
    .index("by_user_and_media_type_and_work_id", ["userId", "mediaType", "workId"]),
  userSettings: defineTable({
    userId: v.id("users"),
    realDebridApiKey: v.optional(v.string()),
    streamMode: v.optional(streamModeValidator),
    externalPlayer: v.optional(externalPlayerValidator),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // --- Music library --------------------------------------------------------

  /** User-liked tracks (Spotify ids + denormalized metadata for offline render). */
  likedSongs: defineTable({
    userId: v.id("users"),
    ...musicTrackValidator.fields,
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_track", ["userId", "id"]),

  /** User-created playlists. */
  playlists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    /** Denormalized so library list does not scan every track doc. */
    trackCount: v.optional(v.number()),
    coverImageUrl: v.optional(v.string()),
    /** Set when the playlist was created via a Spotify import. */
    spotifyPlaylistId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /** Tracks in a playlist; metadata denormalized so we don't fetch Spotify. */
  playlistTracks: defineTable({
    playlistId: v.id("playlists"),
    userId: v.id("users"),
    ...musicTrackValidator.fields,
    addedAt: v.number(),
    position: v.number(),
  })
    .index("by_playlist", ["playlistId"])
    .index("by_playlist_and_position", ["playlistId", "position"])
    .index("by_playlist_and_track", ["playlistId", "id"])
    .index("by_user", ["userId"]),

  /**
   * Denormalized liked-song count so like/unlike/import can enforce the cap
   * without scanning tens of thousands of documents.
   */
  userMusicStats: defineTable({
    userId: v.id("users"),
    likedCount: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /**
   * Future personalization signals. Logged now; no ranking model consumes this yet.
   */
  musicInteractions: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("play"),
      v.literal("skip"),
      v.literal("complete"),
      v.literal("select"),
      v.literal("search"),
      v.literal("click"),
    ),
    trackId: v.optional(v.string()),
    title: v.optional(v.string()),
    artists: v.optional(v.array(v.string())),
    query: v.optional(v.string()),
    resultId: v.optional(v.string()),
    resultKind: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user_and_created", ["userId", "createdAt"]),

  /** Long-running Spotify → JedFlix library import. One active job per user. */
  spotifyImportJobs: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    totalItems: v.number(),
    completedItems: v.number(),
    importedTracks: v.number(),
    skippedTracks: v.number(),
    currentLabel: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /** One playlist (or Liked Songs) within an import job. */
  spotifyImportItems: defineTable({
    jobId: v.id("spotifyImportJobs"),
    userId: v.id("users"),
    kind: v.union(v.literal("liked_songs"), v.literal("playlist")),
    spotifyPlaylistId: v.optional(v.string()),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    jedflixPlaylistId: v.optional(v.id("playlists")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    /** Next Spotify API offset for this item. */
    spotifyOffset: v.number(),
    imported: v.number(),
    skipped: v.number(),
    total: v.optional(v.number()),
    /** Order within the job (0 = first). */
    sortOrder: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_job", ["jobId"])
    .index("by_job_and_status", ["jobId", "status"]),

  // --- Party mode -----------------------------------------------------------

  /** A user's linked Spotify account. Tokens never leave the Convex backend. */
  spotifyAccounts: defineTable({
    userId: v.id("users"),
    spotifyUserId: v.string(),
    displayName: v.string(),
    // "premium" | "free" | "open". Playback control requires premium.
    product: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scope: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /** Single-use CSRF state for the Spotify authorization-code flow. */
  spotifyOauthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    redirectPath: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),

  /** Stable party identity. Playback lives in partyPlayback to keep churn off this doc. */
  parties: defineTable({
    code: v.string(),
    hostUserId: v.id("users"),
    closedAt: v.optional(v.number()),
    // Guards against duplicate Spotify poll loops after restarts.
    pollRunning: v.boolean(),
    pollGeneration: v.number(),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_host", ["hostUserId"]),

  /** High-churn playback state: one row per party. */
  partyPlayback: defineTable({
    partyId: v.id("parties"),
    track: v.optional(partyTrackValidator),
    // Index into partyQueue.tracks, or -1 when the track came from outside the queue.
    queueIndex: v.number(),
    isPlaying: v.boolean(),
    /** Playback offset that was correct at `positionUpdatedAt`. */
    positionMs: v.optional(v.number()),
    /** Wall clock for `positionMs`; advance while `isPlaying` on the client. */
    positionUpdatedAt: v.optional(v.number()),
    // Monotonic; lets a scheduled Spotify push detect that it has been superseded.
    revision: v.number(),
    // "member:<clientId>" or "spotify:<accountId>" — used to skip echoes.
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_party", ["partyId"]),

  /** Party queue, rewritten only when a client replaces the whole queue. */
  partyQueue: defineTable({
    partyId: v.id("parties"),
    tracks: v.array(partyTrackValidator),
    updatedAt: v.number(),
  }).index("by_party", ["partyId"]),

  /** One row per connected client (browser/device) in a party. */
  partyMembers: defineTable({
    partyId: v.id("parties"),
    userId: v.id("users"),
    clientId: v.string(),
    deviceLabel: v.string(),
    lastSeenAt: v.number(),
    joinedAt: v.number(),
  })
    .index("by_party", ["partyId"])
    .index("by_party_and_client", ["partyId", "clientId"])
    .index("by_user_and_client", ["userId", "clientId"]),

  /** A Spotify account mirroring a party, plus the Connect device it drives. */
  partySpotifyTargets: defineTable({
    partyId: v.id("parties"),
    accountId: v.id("spotifyAccounts"),
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    deviceName: v.optional(v.string()),
    enabled: v.boolean(),
    lastPushedTrackId: v.optional(v.string()),
    lastPushedAt: v.number(),
    lastObservedTrackId: v.optional(v.string()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_party", ["partyId"])
    .index("by_party_and_account", ["partyId", "accountId"])
    .index("by_user", ["userId"]),
});
