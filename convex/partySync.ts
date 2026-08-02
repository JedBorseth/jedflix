/**
 * Spotify ↔ party bridge for follow mode.
 *
 * - Spotify → JedFlix: `pollParty` watches `/me/player` and applies track,
 *   play/pause, and position into the party (JedFlix never picks Spotify's song).
 * - JedFlix → Spotify: only pause/resume via `pushPlayStateToSpotify`. Track
 *   changes and seeks are not pushed.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  estimatedPositionMs,
  MEMBER_STALE_WINDOW_MS,
  PARTY_POLL_INTERVAL_MS,
  SPOTIFY_PUSH_GRACE_MS,
  shouldSyncPosition,
  spotifyTrackToPartyTrack,
  type PartyTrack,
} from "./partyModel";
import { ensureAccessToken } from "./spotify";
import {
  describeSpotifyError,
  getPlaybackState,
  pausePlayback,
  resumePlayback,
} from "./spotifyApi";

type Target = Doc<"partySpotifyTargets">;

type Observation =
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "state"; track: PartyTrack | null; isPlaying: boolean; progressMs: number };

async function observeTarget(ctx: ActionCtx, target: Target): Promise<Observation> {
  try {
    const accessToken = await ensureAccessToken(ctx, target.accountId);
    const state = await getPlaybackState(accessToken);
    if (!state) {
      return { kind: "idle" };
    }
    return {
      kind: "state",
      track: spotifyTrackToPartyTrack(state.item),
      isPlaying: state.isPlaying,
      progressMs: state.progressMs,
    };
  } catch (error) {
    return { kind: "error", message: describeSpotifyError(error) };
  }
}

/** Pause or resume linked Spotify players to match the party — never change track. */
export const pushPlayStateToSpotify = internalAction({
  args: {
    partyId: v.id("parties"),
    revision: v.number(),
    isPlaying: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(internal.party.getSyncSnapshot, {
      partyId: args.partyId,
    });
    if (!snapshot || snapshot.party.closedAt !== undefined || !snapshot.playback) {
      return null;
    }
    if (snapshot.playback.revision !== args.revision) {
      return null;
    }

    await Promise.all(
      snapshot.targets.map(async (target) => {
        try {
          const accessToken = await ensureAccessToken(ctx, target.accountId);
          if (args.isPlaying) {
            await resumePlayback(accessToken, target.deviceId);
          } else {
            await pausePlayback(accessToken, target.deviceId);
          }
          await ctx.runMutation(internal.party.recordPlayPush, { targetId: target._id });
        } catch (error) {
          await ctx.runMutation(internal.party.recordPlayPush, {
            targetId: target._id,
            error: describeSpotifyError(error),
          });
        }
      }),
    );
    return null;
  },
});

export const pollParty = internalAction({
  args: { partyId: v.id("parties"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(internal.party.getSyncSnapshot, {
      partyId: args.partyId,
    });
    if (!snapshot) {
      return null;
    }
    // A newer loop took over (e.g. after a restart); let this one die.
    if (snapshot.party.pollGeneration !== args.generation) {
      return null;
    }
    // Every client has stopped sending heartbeats — clean up and let the loop end.
    if (Date.now() - snapshot.lastMemberSeenAt > MEMBER_STALE_WINDOW_MS) {
      await ctx.runMutation(internal.party.sweepParty, { partyId: args.partyId });
      await ctx.runMutation(internal.party.stopPolling, { partyId: args.partyId });
      return null;
    }
    if (snapshot.party.closedAt !== undefined || snapshot.targets.length === 0) {
      await ctx.runMutation(internal.party.stopPolling, { partyId: args.partyId });
      return null;
    }

    const partyTrackId = snapshot.playback?.track?.id ?? null;
    const partyPlaying = snapshot.playback?.isPlaying ?? false;
    const now = Date.now();
    const partyPosition = snapshot.playback
      ? estimatedPositionMs({
          positionMs: snapshot.playback.positionMs ?? 0,
          positionUpdatedAt: snapshot.playback.positionUpdatedAt ?? now,
          isPlaying: partyPlaying,
          now,
          durationMs: snapshot.playback.track?.durationMs,
        })
      : 0;
    let applied = false;

    for (const target of snapshot.targets) {
      const observation = await observeTarget(ctx, target);

      if (observation.kind === "error") {
        await ctx.runMutation(internal.party.recordObservation, {
          targetId: target._id,
          trackId: target.lastObservedTrackId,
          error: observation.message,
        });
        continue;
      }
      if (observation.kind === "idle") {
        await ctx.runMutation(internal.party.recordObservation, { targetId: target._id });
        continue;
      }

      const observedTrack = observation.track;
      await ctx.runMutation(internal.party.recordObservation, {
        targetId: target._id,
        trackId: observedTrack?.id,
      });

      // Device may still be catching up after a JedFlix pause/resume push.
      if (now - target.lastPushedAt < SPOTIFY_PUSH_GRACE_MS) {
        continue;
      }

      // Only the first Spotify change per tick wins; JedFlix clients pick it up
      // from party state.
      if (applied || !observedTrack) {
        continue;
      }

      if (observedTrack.id !== partyTrackId) {
        await ctx.runMutation(internal.party.applySpotifyChange, {
          partyId: args.partyId,
          accountId: target.accountId,
          track: observedTrack,
          isPlaying: observation.isPlaying,
          positionMs: observation.progressMs,
        });
        applied = true;
        continue;
      }

      const positionChanged = shouldSyncPosition(observation.progressMs, partyPosition);
      const playingChanged = observation.isPlaying !== partyPlaying;
      if (positionChanged || playingChanged) {
        await ctx.runMutation(internal.party.applySpotifyChange, {
          partyId: args.partyId,
          accountId: target.accountId,
          track: observedTrack,
          isPlaying: observation.isPlaying,
          positionMs: observation.progressMs,
        });
        applied = true;
      }
    }

    await ctx.scheduler.runAfter(PARTY_POLL_INTERVAL_MS, internal.partySync.pollParty, {
      partyId: args.partyId,
      generation: args.generation,
    });
    return null;
  },
});
