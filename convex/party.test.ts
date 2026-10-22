/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const token = "a".repeat(64);
const secondToken = "b".repeat(64);
const track = {
  id: "track-one",
  title: "One",
  artists: ["Artist"],
  albumName: "Album",
  imageUrl: "",
  durationMs: 200_000,
};

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Host" }));
  const host = t.withIdentity({ subject: `${userId}|host-session` });
  const party = await host.mutation(api.party.create, {
    clientId: "host",
    deviceLabel: "Host device",
  });
  return { t, host, party, userId };
}

test("only signed-in users can create parties", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.party.create, { clientId: "guest", deviceLabel: "Phone" }),
  ).rejects.toThrow("Must be signed in");
});

test("fresh guest joins without auth, gets shared playback, and cannot impersonate the host", async () => {
  const { t, host, party } = await setup();
  await host.mutation(api.party.setTrack, {
    clientId: "host",
    track,
    queueIndex: 0,
    queue: [track],
  });
  await t.mutation(api.party.joinGuest, {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  });
  const guest = await t.query(api.party.getGuestState, { guestToken: token });
  expect(guest).toMatchObject({
    isHost: false,
    track,
    code: party.code,
    spotifyTargets: [],
  });
  expect(guest?.members).toHaveLength(2);
  expect(guest?.members.find((member) => member.isSelf)?.userName).toMatch(
    /^Guest \d{4}$/,
  );
  expect(JSON.stringify(guest)).not.toContain(token);
  expect(
    await t.query(api.party.getGuestState, { guestToken: secondToken }),
  ).toBeNull();
  expect(await t.query(api.party.getState, { clientId: "host" })).toBeNull();
  await expect(
    t.mutation(api.party.setPlaying, { clientId: "host", isPlaying: false }),
  ).rejects.toThrow("Must be signed in");
});

test("guests can change tracks, play/pause, and seek using only their own credential", async () => {
  const { t, host, party } = await setup();
  await t.mutation(api.party.joinGuest, {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  });
  const credentials = { clientId: "host", guestToken: token };
  await t.mutation(api.party.setTrack, {
    ...credentials,
    track,
    queueIndex: 0,
    queue: [track],
  });
  await t.mutation(api.party.setPlaying, { ...credentials, isPlaying: false });
  await t.mutation(api.party.setPosition, {
    ...credentials,
    positionMs: 30_000,
  });
  const state = await host.query(api.party.getState, { clientId: "host" });
  expect(state).toMatchObject({ track, isPlaying: false, positionMs: 30_000 });
  expect(state?.updatedBy).not.toBe("member:host");
  await expect(
    t.mutation(api.party.setTrack, {
      clientId: "host",
      guestToken: secondToken,
      track,
      queueIndex: 0,
    }),
  ).rejects.toThrow("not in a party");
  await expect(
    t.mutation(api.party.setSpotifyTarget, { clientId: "host", enabled: true }),
  ).rejects.toThrow("Must be signed in");
});

test("repeat joins retain the same guest seat and leaving revokes playback access", async () => {
  const { t, host, party } = await setup();
  const joinArgs = {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  };
  await t.mutation(api.party.joinGuest, joinArgs);
  await t.mutation(api.party.joinGuest, joinArgs);
  expect(
    (await host.query(api.party.getState, { clientId: "host" }))?.members,
  ).toHaveLength(2);
  await t.mutation(api.party.leaveGuest, { guestToken: token });
  expect(
    await t.query(api.party.getGuestState, { guestToken: token }),
  ).toBeNull();
  await expect(
    t.mutation(api.party.setPlaying, {
      guestToken: token,
      clientId: "x",
      isPlaying: true,
    }),
  ).rejects.toThrow("not in a party");
});

test("host leaving ends the party for guests and signed-in members", async () => {
  const { t, host, party } = await setup();
  await t.mutation(api.party.joinGuest, {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  });
  await host.mutation(api.party.leave, { clientId: "host" });
  expect(
    await t.query(api.party.getGuestState, { guestToken: token }),
  ).toBeNull();
  await expect(
    t.mutation(api.party.joinGuest, {
      code: party.code,
      guestToken: secondToken,
      deviceLabel: "Other",
    }),
  ).rejects.toThrow("No active party");
  await expect(
    t.mutation(api.party.setPlaying, {
      guestToken: token,
      clientId: "x",
      isPlaying: true,
    }),
  ).rejects.toThrow("Party has ended");
});

test("invalid and expired invites fail without joining", async () => {
  const { t, party } = await setup();
  await expect(
    t.mutation(api.party.joinGuest, {
      code: "!",
      guestToken: token,
      deviceLabel: "Phone",
    }),
  ).rejects.toThrow("code doesn't look right");
  await expect(
    t.mutation(api.party.joinGuest, {
      code: party.code,
      guestToken: "bad",
      deviceLabel: "Phone",
    }),
  ).rejects.toThrow("Invalid guest session");
  await t.run((ctx) => ctx.db.patch(party.partyId, { closedAt: Date.now() }));
  await expect(
    t.mutation(api.party.joinGuest, {
      code: party.code,
      guestToken: token,
      deviceLabel: "Phone",
    }),
  ).rejects.toThrow("No active party");
});

test("guest heartbeats keep the party alive and stale guests are pruned", async () => {
  const { t, party } = await setup();
  await t.mutation(api.party.joinGuest, {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  });
  const guestId = await t.run(
    async (ctx) => (await ctx.db.query("partyGuests").first())!._id,
  );
  await t.run((ctx) =>
    ctx.db.patch(guestId, { lastSeenAt: Date.now() - 60_000 }),
  );
  await t.mutation(api.party.heartbeatGuest, { guestToken: token });
  const snapshot = await t.query(internal.party.getSyncSnapshot, {
    partyId: party.partyId,
  });
  expect(snapshot!.lastMemberSeenAt).toBeGreaterThan(Date.now() - 5000);
  await t.run((ctx) =>
    ctx.db.patch(guestId, { lastSeenAt: Date.now() - 360_000 }),
  );
  await t.mutation(internal.party.sweepParty, { partyId: party.partyId });
  expect(
    await t.query(api.party.getGuestState, { guestToken: token }),
  ).toBeNull();
});

test("guest queue edits are shared without restarting paused playback", async () => {
  const { t, host, party } = await setup();
  await host.mutation(api.party.setTrack, {
    clientId: "host",
    track,
    queueIndex: 0,
    queue: [track],
  });
  await host.mutation(api.party.setPlaying, {
    clientId: "host",
    isPlaying: false,
  });
  await host.mutation(api.party.setPosition, {
    clientId: "host",
    positionMs: 20_000,
  });
  await t.mutation(api.party.joinGuest, {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  });
  const next = { ...track, id: "track-two", title: "Two" };
  await t.mutation(api.party.setQueue, {
    clientId: "guest",
    guestToken: token,
    tracks: [track, next],
  });
  expect(
    await host.query(api.party.getState, { clientId: "host" }),
  ).toMatchObject({
    track,
    queue: [track, next],
    isPlaying: false,
    positionMs: 20_000,
  });
});

test("reopening your own invite does not close the host's party", async () => {
  const { host, party } = await setup();
  await host.mutation(api.party.join, {
    code: party.code,
    clientId: "host",
    deviceLabel: "Host device",
  });
  expect(
    (await host.query(api.party.getState, { clientId: "host" }))?.isHost,
  ).toBe(true);
});

test("the member limit counts guests and signed-in devices together", async () => {
  const { t, party } = await setup();
  for (let i = 0; i < 24; i += 1) {
    await t.mutation(api.party.joinGuest, {
      code: party.code,
      guestToken: i.toString(16).padStart(64, "0"),
      deviceLabel: "Phone",
    });
  }
  await expect(
    t.mutation(api.party.joinGuest, {
      code: party.code,
      guestToken: token,
      deviceLabel: "Full party",
    }),
  ).rejects.toThrow("This party is full");
});

test("a disconnected host ends the party after 5 minutes even while guests stay active", async () => {
  const { t, host, party } = await setup();
  await t.mutation(api.party.joinGuest, {
    code: party.code,
    guestToken: token,
    deviceLabel: "Phone",
  });
  await t.run(async (ctx) => {
    const member = await ctx.db
      .query("partyMembers")
      .withIndex("by_party", (q) => q.eq("partyId", party.partyId))
      .first();
    await ctx.db.patch(member!._id, { lastSeenAt: Date.now() - 300_001 });
  });
  await t.mutation(api.party.heartbeatGuest, { guestToken: token });
  await t.mutation(internal.party.sweepParty, { partyId: party.partyId });
  expect(
    await t.query(api.party.getGuestState, { guestToken: token }),
  ).toBeNull();
  expect(await host.query(api.party.getState, { clientId: "host" })).toBeNull();
});

test("a host reconnect within the grace period keeps the party open", async () => {
  const { t, host, party } = await setup();
  await t.run(async (ctx) => {
    const member = await ctx.db.query("partyMembers").first();
    await ctx.db.patch(member!._id, { lastSeenAt: Date.now() - 240_000 });
  });
  await host.mutation(api.party.heartbeat, { clientId: "host" });
  await t.mutation(internal.party.sweepParty, { partyId: party.partyId });
  expect(
    (await host.query(api.party.getState, { clientId: "host" }))?.code,
  ).toBe(party.code);
});
