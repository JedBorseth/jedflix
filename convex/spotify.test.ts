/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("OAuth state creation cleans up by owner and expiry and validates the redirect path", async () => {
  vi.stubEnv("SITE_URL", "https://jedflix.example.test");
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const otherUserId = await ctx.db.insert("users", {});
    const expiresAt = Date.now() + 60_000;
    for (let index = 0; index < 50; index++) {
      await ctx.db.insert("spotifyOauthStates", {
        userId: otherUserId,
        expiresAt,
        state: `other-${index}`,
        redirectPath: "/music",
      });
    }
    await ctx.db.insert("spotifyOauthStates", {
      userId,
      expiresAt,
      state: "previous",
      redirectPath: "/music",
    });
    await ctx.db.insert("spotifyOauthStates", {
      userId: otherUserId,
      expiresAt: 0,
      state: "expired",
      redirectPath: "/music",
    });
    return userId;
  });
  const viewer = t.withIdentity({ subject: `${userId}|session` });
  await viewer.mutation(internal.spotify.createOauthState, {
    state: "new",
    redirectPath: String.raw`/\elsewhere.example.test`,
  });

  const states = await t.run((ctx) =>
    ctx.db.query("spotifyOauthStates").collect(),
  );
  expect(states).toHaveLength(51);
  expect(states.find((row) => row.state === "new")?.redirectPath).toBe(
    "/music",
  );
  expect(
    states.some((row) => row.state === "previous" || row.state === "expired"),
  ).toBe(false);
});

test.each([
  [String.raw`/\elsewhere.example.test`, "/music", "", ""],
  ["/music/library?view=albums#saved", "/music/library", "albums", "#saved"],
])(
  "the Spotify callback validates stored return path %s",
  async (redirectPath, path, view, hash) => {
    vi.stubEnv("SITE_URL", "https://jedflix.example.test");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      await ctx.db.insert("spotifyOauthStates", {
        userId,
        state: "pending",
        redirectPath,
        expiresAt: Date.now() + 60_000,
      });
    });

    const response = await t.fetch(
      "/spotify/callback?state=pending&error=access_denied",
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin).toBe("https://jedflix.example.test");
    expect(location.pathname).toBe(path);
    expect(location.searchParams.get("view") ?? "").toBe(view);
    expect(location.searchParams.get("spotify")).toBe("error");
    expect(location.hash).toBe(hash);
  },
);

test("Spotify imports detect running jobs beyond the old lookup cap and schedule the first batch", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    for (let index = 0; index < 10; index++) {
      await ctx.db.insert("spotifyImportJobs", {
        userId,
        status: "completed",
        totalItems: 1,
        completedItems: 1,
        importedTracks: 0,
        skippedTracks: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    return userId;
  });
  const viewer = t.withIdentity({ subject: `${userId}|session` });
  const args = { importLikedSongs: true, playlists: [] };

  const jobId = await viewer.mutation(internal.spotifyImport.createJob, args);
  await expect(
    viewer.mutation(internal.spotifyImport.createJob, args),
  ).rejects.toThrow("An import is already running");
  expect(await viewer.query(api.spotifyImport.getActiveJob, {})).toMatchObject({
    _id: jobId,
    status: "running",
  });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const job = await t.run((ctx) => ctx.db.get(jobId));
  expect(job).toMatchObject({
    status: "failed",
    error: "Spotify account was disconnected during import.",
  });
});
