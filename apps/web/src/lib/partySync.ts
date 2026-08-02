/**
 * Decides which way a party sync should flow on any given tick.
 *
 * The player and the party each hold a snapshot of "what track, playing or
 * not". When they disagree we need to know who moved, otherwise applying a
 * remote change looks like a local change on the next render and the two sides
 * ping-pong forever. Baselines record what each side looked like the last time
 * we reconciled, and after acting we set the baselines to the state we expect
 * both sides to settle on.
 */

export type PartySnapshot = {
  trackId: string | null;
  playing: boolean;
};

export type PartySyncAction = "idle" | "push" | "apply";

export type PartySyncDecision = {
  action: PartySyncAction;
  nextLocal: PartySnapshot;
  nextRemote: PartySnapshot;
};

export function snapshotsEqual(a: PartySnapshot, b: PartySnapshot): boolean {
  return a.trackId === b.trackId && a.playing === b.playing;
}

export function resolvePartySync(args: {
  local: PartySnapshot;
  remote: PartySnapshot;
  lastLocal: PartySnapshot | null;
  lastRemote: PartySnapshot | null;
}): PartySyncDecision {
  const { local, remote, lastLocal, lastRemote } = args;

  if (snapshotsEqual(local, remote)) {
    return { action: "idle", nextLocal: local, nextRemote: remote };
  }

  // First reconciliation after joining: adopt the party if it has something
  // going, otherwise offer up whatever this device is already playing.
  if (lastLocal === null || lastRemote === null) {
    if (remote.trackId !== null) {
      return applyDecision(remote);
    }
    return local.trackId !== null
      ? pushDecision(local)
      : { action: "idle", nextLocal: local, nextRemote: remote };
  }

  const remoteChanged = !snapshotsEqual(remote, lastRemote);
  const localChanged = !snapshotsEqual(local, lastLocal);

  // The party is authoritative, so a remote move wins a simultaneous change.
  if (remoteChanged) {
    return applyDecision(remote);
  }
  if (localChanged) {
    return pushDecision(local);
  }

  // Neither side moved but they still disagree — a previous action did not
  // stick. Converge on the party unless it has nothing to offer.
  return remote.trackId !== null ? applyDecision(remote) : pushDecision(local);
}

function applyDecision(remote: PartySnapshot): PartySyncDecision {
  return { action: "apply", nextLocal: remote, nextRemote: remote };
}

function pushDecision(local: PartySnapshot): PartySyncDecision {
  return { action: "push", nextLocal: local, nextRemote: local };
}

/** Stable identity for a queue, so it is only re-uploaded when it changes. */
export function queueSignature(trackIds: string[]): string {
  return trackIds.join("|");
}
