/**
 * The two-way bridge between a party and the Spotify accounts mirroring it.
 *
 * JedFlix -> Spotify: every playback mutation schedules `pushToSpotify`.
 * Spotify -> JedFlix: `pollParty` self-reschedules while the party is live and
 * watches `GET /me/player` for changes made on a Spotify client.
 *
 * Echo suppression relies on two things: pushes carry the playback `revision`
 * so a stale push is dropped, and polled state is ignored for a short grace
 * window after a push so a device that is still catching up is not mistaken
 * for a user action.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  MEMBER_STALE_WINDOW_MS,
  PARTY_POLL_INTERVAL_MS,
  SPOTIFY_CONTEXT_TRACKS,
  SPOTIFY_PUSH_GRACE_MS,
  spotifyTrackToPartyTrack,
  toSpotifyTrackUri,
  type PartyTrack,
} from "./partyModel";
import { ensureAccessToken } from "./spotify";
import {
  describeSpotifyError,
  getPlaybackState,
  pausePlayback,
  resumePlayback,
  startPlayback,
} from "./spotifyApi";

type Target = Doc<"partySpotifyTargets">;

/**
 * Current track first, then the next few queued tracks so the Spotify device
 * has somewhere to go when the track ends.
 */
function playbackUris(track: PartyTrack, queue: PartyTrack[], queueIndex: number): string[] {
  const inQueue = queueIndex >= 0 && queue[queueIndex]?.id === track.id;
  const window = inQueue
    ? queue.slice(queueIndex, queueIndex + 1 + SPOTIFY_CONTEXT_TRACKS)
    : [track];
  const uris = window
    .map((item) => toSpotifyTrackUri(item.id))
    .filter((uri): uri is string => uri !== null);
  return uris;
}

async function pushToTarget(
  ctx: ActionCtx,
  target: Target,
  args: { track: PartyTrack; uris: string[]; isPlaying: boolean; force: boolean },
): Promise<void> {
  try {
    const accessToken = await ensureAccessToken(ctx, target.accountId);
    const trackChanged = args.force || target.lastPushedTrackId !== args.track.id;

    if (trackChanged) {
      await startPlayback(accessToken, { uris: args.uris, deviceId: target.deviceId });
      if (!args.isPlaying) {
        await pausePlayback(accessToken, target.deviceId);
      }
    } else if (args.isPlaying) {
      await resumePlayback(accessToken, target.deviceId);
    } else {
      await pausePlayback(accessToken, target.deviceId);
    }

    await ctx.runMutation(internal.party.recordPush, {
      targetId: target._id,
      trackId: args.track.id,
    });
  } catch (error) {
    await ctx.runMutation(internal.party.recordPush, {
      targetId: target._id,
      trackId: args.track.id,
      error: describeSpotifyError(error),
    });
  }
}

export const pushToSpotify = internalAction({
  args: {
    partyId: v.id("parties"),
    revision: v.number(),
    /** The account whose Spotify client caused this change — do not echo back. */
    skipAccountId: v.optional(v.id("spotifyAccounts")),
    /** Push even if the track is unchanged (used when a device is first attached). */
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(internal.party.getSyncSnapshot, {
      partyId: args.partyId,
    });
    if (!snapshot || snapshot.party.closedAt !== undefined || !snapshot.playback) {
      return null;
    }
    // A newer change already landed; that one will drive the devices instead.
    if (!args.force && snapshot.playback.revision !== args.revision) {
      return null;
    }

    const { track, queueIndex, isPlaying } = snapshot.playback;
    if (!track) {
      return null;
    }
    const uris = playbackUris(track, snapshot.queue, queueIndex);
    if (uris.length === 0) {
      return null;
    }

    const targets = snapshot.targets.filter(
      (target) => target.accountId !== args.skipAccountId,
    );
    await Promise.all(
      targets.map((target) =>
        pushToTarget(ctx, target, { track, uris, isPlaying, force: args.force === true }),
      ),
    );
    return null;
  },
});

type Observation =
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "state"; track: PartyTrack | null; isPlaying: boolean };

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
    };
  } catch (error) {
    return { kind: "error", message: describeSpotifyError(error) };
  }
}

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

      // The device may still be catching up with a push we just made.
      if (now - target.lastPushedAt < SPOTIFY_PUSH_GRACE_MS) {
        continue;
      }
      // Only the first change per tick wins; the rest get it via the push back.
      if (applied || !observedTrack) {
        continue;
      }

      if (observedTrack.id !== partyTrackId) {
        await ctx.runMutation(internal.party.applySpotifyChange, {
          partyId: args.partyId,
          accountId: target.accountId,
          track: observedTrack,
          isPlaying: observation.isPlaying,
        });
        applied = true;
        continue;
      }

      // Same track: a play/pause on the Spotify client counts, a stale idle
      // device sitting on some other track does not.
      if (observation.isPlaying !== partyPlaying) {
        await ctx.runMutation(internal.party.applySpotifyChange, {
          partyId: args.partyId,
          accountId: target.accountId,
          track: observedTrack,
          isPlaying: observation.isPlaying,
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
