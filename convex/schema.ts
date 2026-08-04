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
    .index("by_playlist_and_track", ["playlistId", "id"])
    .index("by_user", ["userId"]),

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
    /**
     * Shared YouTube video id for the current track so party members reuse one
     * stream resolve instead of each running yt-dlp search.
     */
    youtubeVideoId: v.optional(v.string()),
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
