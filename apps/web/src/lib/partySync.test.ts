import { describe, expect, test } from "bun:test";
import { resolvePartySync, type PartySnapshot } from "@/lib/partySync";

const idle: PartySnapshot = { trackId: null, playing: false };
const playingA: PartySnapshot = { trackId: "a", playing: true };
const pausedA: PartySnapshot = { trackId: "a", playing: false };
const playingB: PartySnapshot = { trackId: "b", playing: true };

describe("resolvePartySync", () => {
  test("does nothing when both sides already agree", () => {
    const decision = resolvePartySync({
      local: playingA,
      remote: playingA,
      lastLocal: playingA,
      lastRemote: playingA,
    });
    expect(decision.action).toBe("idle");
  });

  test("adopts the party on first reconciliation when it is already playing", () => {
    const decision = resolvePartySync({
      local: idle,
      remote: playingA,
      lastLocal: null,
      lastRemote: null,
    });
    expect(decision.action).toBe("apply");
    // Baselines jump to the remote state so the resulting local change is not
    // mistaken for a user action.
    expect(decision.nextLocal).toEqual(playingA);
    expect(decision.nextRemote).toEqual(playingA);
  });

  test("offers up local playback when joining an empty party", () => {
    const decision = resolvePartySync({
      local: playingA,
      remote: idle,
      lastLocal: null,
      lastRemote: null,
    });
    expect(decision.action).toBe("push");
    expect(decision.nextRemote).toEqual(playingA);
  });

  test("pushes a local track change", () => {
    const decision = resolvePartySync({
      local: playingB,
      remote: playingA,
      lastLocal: playingA,
      lastRemote: playingA,
    });
    expect(decision.action).toBe("push");
    expect(decision.nextLocal).toEqual(playingB);
    expect(decision.nextRemote).toEqual(playingB);
  });

  test("applies a remote track change", () => {
    const decision = resolvePartySync({
      local: playingA,
      remote: playingB,
      lastLocal: playingA,
      lastRemote: playingA,
    });
    expect(decision.action).toBe("apply");
  });

  test("the party wins when both sides move at once", () => {
    const decision = resolvePartySync({
      local: playingB,
      remote: pausedA,
      lastLocal: playingA,
      lastRemote: playingA,
    });
    expect(decision.action).toBe("apply");
    expect(decision.nextLocal).toEqual(pausedA);
  });

  test("applying does not bounce back as a local change", () => {
    // Tick 1: remote moved to B, so we apply it.
    const first = resolvePartySync({
      local: playingA,
      remote: playingB,
      lastLocal: playingA,
      lastRemote: playingA,
    });
    expect(first.action).toBe("apply");

    // Tick 2: the player has caught up. Without the baseline jump this would
    // look like a local change and get pushed straight back.
    const second = resolvePartySync({
      local: playingB,
      remote: playingB,
      lastLocal: first.nextLocal,
      lastRemote: first.nextRemote,
    });
    expect(second.action).toBe("idle");
  });

  test("pushing does not bounce back as a remote change", () => {
    const first = resolvePartySync({
      local: playingB,
      remote: playingA,
      lastLocal: playingA,
      lastRemote: playingA,
    });
    expect(first.action).toBe("push");

    const second = resolvePartySync({
      local: playingB,
      remote: playingB,
      lastLocal: first.nextLocal,
      lastRemote: first.nextRemote,
    });
    expect(second.action).toBe("idle");
  });

  test("converges on the party when an earlier action was dropped", () => {
    const decision = resolvePartySync({
      local: pausedA,
      remote: playingA,
      lastLocal: pausedA,
      lastRemote: playingA,
    });
    expect(decision.action).toBe("apply");
  });

  test("pushes local state when a dropped action left the party empty", () => {
    const decision = resolvePartySync({
      local: playingA,
      remote: idle,
      lastLocal: playingA,
      lastRemote: idle,
    });
    expect(decision.action).toBe("push");
  });
});
