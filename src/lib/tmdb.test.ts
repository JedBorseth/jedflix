import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  discoverMedia,
  getMediaDetailPath,
  getMediaDetails,
  getSimilarMedia,
  searchMedia,
} from "./tmdb";

function mockFetch(body: unknown, status = 200) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as typeof fetch;
}

describe("tmdb", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("getMediaDetailPath routes movies and shows separately", () => {
    expect(getMediaDetailPath({ id: 10, mediaType: "movie" })).toBe("/movie/10");
    expect(getMediaDetailPath({ id: 10, mediaType: "tv" })).toBe("/show/10");
  });

  test("searchMedia normalizes movie results and filters people", async () => {
    globalThis.fetch = mockFetch({
      results: [
        {
          id: 1,
          media_type: "movie",
          title: "A Movie",
          overview: "Overview",
          poster_path: "/poster.jpg",
          backdrop_path: "/backdrop.jpg",
          release_date: "2024-05-01",
          vote_average: 7.25,
        },
        {
          id: 2,
          media_type: "person",
          name: "An Actor",
        },
      ],
    });

    const results = await searchMedia("movie");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 1,
      mediaType: "movie",
      title: "A Movie",
      year: 2024,
      rating: "7.3 TMDB",
      posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
      backdropUrl: "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("discoverMedia uses the requested media type", async () => {
    globalThis.fetch = mockFetch({
      results: [
        {
          id: 99,
          name: "A Show",
          overview: "Series overview",
          first_air_date: "2023-01-01",
          vote_average: 8,
        },
      ],
    });

    const results = await discoverMedia("tv");

    expect(results).toHaveLength(1);
    expect(results[0]?.mediaType).toBe("tv");
    expect(results[0]?.title).toBe("A Show");
    expect(String(globalThis.fetch.mock.calls[0]?.[0])).toContain("/discover/tv");
  });

  test("getMediaDetails includes runtime and genres", async () => {
    globalThis.fetch = mockFetch({
      id: 5,
      title: "Detailed Movie",
      overview: "Long overview",
      poster_path: "/poster.jpg",
      backdrop_path: "/backdrop.jpg",
      release_date: "2022-06-15",
      vote_average: 6,
      runtime: 132,
      genres: [{ id: 28, name: "Action" }, { id: 12, name: "Adventure" }],
    });

    const result = await getMediaDetails("movie", 5);

    expect(result).toMatchObject({
      id: 5,
      mediaType: "movie",
      title: "Detailed Movie",
      durationMinutes: 132,
      genre: "Action, Adventure",
      rating: "6.0 TMDB",
    });
  });

  test("getSimilarMedia returns recommendations excluding the current title", async () => {
    globalThis.fetch = mockFetch({
      results: [
        {
          id: 10,
          title: "Current Movie",
          overview: "Same title",
          poster_path: "/current.jpg",
          backdrop_path: "/current-bg.jpg",
          release_date: "2024-01-01",
          vote_average: 8,
        },
        {
          id: 11,
          title: "Suggested Movie",
          overview: "Recommended",
          poster_path: "/suggested.jpg",
          backdrop_path: "/suggested-bg.jpg",
          release_date: "2023-01-01",
          vote_average: 7.5,
        },
      ],
    });

    const results = await getSimilarMedia("movie", 10);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Suggested Movie");
    expect(String(globalThis.fetch.mock.calls[0]?.[0])).toContain("/movie/10/recommendations");
  });

  test("tmdbFetch throws when the API key is missing", async () => {
    const env = import.meta.env as Record<string, string | undefined>;
    const previousKey = env.VITE_TMDB_API_KEY;
    env.VITE_TMDB_API_KEY = "";

    globalThis.fetch = mockFetch({ results: [] });

    await expect(searchMedia("anything")).rejects.toThrow("Missing VITE_TMDB_API_KEY");

    env.VITE_TMDB_API_KEY = previousKey;
  });

  test("tmdbFetch throws on non-OK responses", async () => {
    globalThis.fetch = mockFetch({ status_message: "Invalid API key" }, 401);

    await expect(searchMedia("anything")).rejects.toThrow("TMDB request failed: 401");
  });
});
