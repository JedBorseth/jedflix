/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type PickInsert = {
  category: "movie" | "tv" | "audiobook" | "music";
  kind: "movie" | "tv" | "audiobook" | "album" | "artist";
  movieId?: number;
  workId?: string;
  catalogId?: string;
  addedAt: number;
};

test("tv picks project curated movies and series in web order", async () => {
  const t = convexTest(schema, modules);
  const insert = (pick: PickInsert) =>
    t.run((ctx) => ctx.db.insert("jedsPicks", pick));

  await insert({
    category: "music",
    kind: "album",
    catalogId: "album-1",
    addedAt: 6_000,
  });
  await insert({ category: "movie", kind: "movie", movieId: 603, addedAt: 1_000 });
  await insert({ category: "tv", kind: "tv", movieId: 1_399, addedAt: 3_000 });
  await insert({
    category: "audiobook",
    kind: "audiobook",
    workId: "OL1W",
    addedAt: 4_000,
  });
  await insert({ category: "movie", kind: "movie", movieId: 155, addedAt: 2_000 });
  await insert({
    category: "music",
    kind: "artist",
    catalogId: "artist-1",
    addedAt: 5_000,
  });
  await insert({ category: "movie", kind: "movie", addedAt: 7_000 });

  const feed = await t.query(internal.jedsPicks.tvPicks, {});

  expect(feed).toEqual({
    version: 1,
    updatedAt: 3_000,
    picks: [
      { tmdbId: 1_399, type: "series" },
      { tmdbId: 155, type: "movie" },
      { tmdbId: 603, type: "movie" },
    ],
  });
});

test("tv picks are empty when no movie or tv picks exist", async () => {
  const t = convexTest(schema, modules);

  await t.run((ctx) =>
    ctx.db.insert("jedsPicks", {
      category: "audiobook",
      kind: "audiobook",
      workId: "OL1W",
      addedAt: 4_000,
    }),
  );

  const feed = await t.query(internal.jedsPicks.tvPicks, {});

  expect(feed).toEqual({ version: 1, updatedAt: 0, picks: [] });
});

test("tv endpoint is public, GET-only, cacheable, and leaks no user data", async () => {
  const t = convexTest(schema, modules);

  await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Jed",
      email: "jedborseth@gmail.com",
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("jedsPicks", {
      category: "tv",
      kind: "tv",
      movieId: 1_399,
      addedAt: 3_000,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("jedsPicks", {
      category: "movie",
      kind: "movie",
      movieId: 603,
      addedAt: 2_000,
    }),
  );

  const response = await t.fetch("/tv/jeds-picks");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");

  const body = await response.text();
  expect(body).not.toContain("jedborseth");
  expect(body).not.toContain("userId");
  expect(JSON.parse(body)).toEqual({
    version: 1,
    updatedAt: 3_000,
    picks: [
      { tmdbId: 1_399, type: "series" },
      { tmdbId: 603, type: "movie" },
    ],
  });

  const post = await t.fetch("/tv/jeds-picks", { method: "POST" });
  expect(post.status).toBe(404);
});
