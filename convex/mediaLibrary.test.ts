/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("watch history and My List apply their caps after ordering by activity", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    for (let movieId = 1; movieId <= 101; movieId++) {
      await ctx.db.insert("watchHistory", {
        userId,
        movieId,
        mediaType: "movie",
        progressSeconds: 60,
        lastWatchedAt: movieId === 1 ? 102 : movieId,
      });
      await ctx.db.insert("myList", {
        userId,
        movieId,
        mediaType: "movie",
        addedAt: movieId === 1 ? 102 : movieId,
      });
    }
    return userId;
  });
  const viewer = t.withIdentity({ subject: `${userId}|session` });

  const history = await viewer.query(api.watchHistory.getForUser, {});
  expect(history).toHaveLength(50);
  expect(history.slice(0, 2).map(({ movieId }) => movieId)).toEqual([1, 101]);
  expect(history[history.length - 1]?.movieId).toBe(53);

  const saved = await viewer.query(api.myList.getForUser, {});
  expect(saved).toHaveLength(100);
  expect(saved.slice(0, 2).map(({ movieId }) => movieId)).toEqual([1, 101]);
  expect(saved[saved.length - 1]?.movieId).toBe(3);
});

test("reviews keep unnamed authors' emails private and reject NaN ratings", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "private@example.test" }),
  );
  const viewer = t.withIdentity({ subject: `${userId}|session` });
  const title = { mediaType: "movie", movieId: 42 } as const;

  await viewer.mutation(api.reviews.submit, {
    ...title,
    rating: 4,
    comment: "Good",
  });
  await expect(
    viewer.mutation(api.reviews.submit, {
      ...title,
      rating: NaN,
      comment: "Invalid",
    }),
  ).rejects.toThrow("Rating must be between 1 and 5 stars");

  const reviews = await t.query(api.reviews.getForMedia, title);
  expect(reviews).toMatchObject([{ userName: "Viewer", rating: 4 }]);
  expect(JSON.stringify(reviews)).not.toContain("private@example.test");
  expect(await t.query(api.reviews.getSummary, title)).toEqual({
    averageRating: 4,
    reviewCount: 1,
  });
});
