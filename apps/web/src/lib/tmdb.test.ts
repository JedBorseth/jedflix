import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  clearTmdbSessionCache,
  configureTmdb,
  discoverMedia,
  getMediaCredits,
  getMediaDetailPath,
  getMediaDetails,
  getPersonDetails,
  getPersonPath,
  getSimilarMedia,
  getTrendingMedia,
  peekDiscoverMedia,
  peekTrendingMedia,
  searchAll,
  searchMedia,
} from "@jedflix/tmdb";

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
    configureTmdb({ backendBaseUrl: "/backend" });
    clearTmdbSessionCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearTmdbSessionCache();
  });

  test("getMediaDetailPath routes movies and shows separately", () => {
    expect(getMediaDetailPath({ id: 10, mediaType: "movie" })).toBe("/movie/10");
    expect(getMediaDetailPath({ id: 10, mediaType: "tv" })).toBe("/show/10");
  });

  test("getPersonPath returns the person route", () => {
    expect(getPersonPath(17419)).toBe("/person/17419");
  });

  test("searchAll returns both media and people", async () => {
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
          popularity: 10,
        },
        {
          id: 17419,
          media_type: "person",
          name: "Bryan Cranston",
          profile_path: "/bryan.jpg",
          popularity: 20,
          known_for: [{ title: "Breaking Bad" }, { name: "Malcolm in the Middle" }],
        },
      ],
    });

    const results = await searchAll("bryan cranston");

    expect(results.media).toHaveLength(1);
    expect(results.media[0]?.title).toBe("A Movie");
    expect(results.people).toHaveLength(1);
    expect(results.people[0]).toMatchObject({
      id: 17419,
      name: "Bryan Cranston",
      profileUrl: "https://image.tmdb.org/t/p/w500/bryan.jpg",
      knownFor: "Breaking Bad, Malcolm in the Middle",
    });
  });

  test("searchAll sorts media and people by popularity descending", async () => {
    globalThis.fetch = mockFetch({
      results: [
        {
          id: 1,
          media_type: "movie",
          title: "Obscure Film",
          overview: "Overview",
          poster_path: "/a.jpg",
          backdrop_path: "/a-bg.jpg",
          release_date: "2020-01-01",
          vote_average: 6,
          popularity: 5,
        },
        {
          id: 2,
          media_type: "movie",
          title: "Blockbuster",
          overview: "Overview",
          poster_path: "/b.jpg",
          backdrop_path: "/b-bg.jpg",
          release_date: "2024-01-01",
          vote_average: 8,
          popularity: 90,
        },
        {
          id: 10,
          media_type: "person",
          name: "Unknown Extra",
          profile_path: "/extra.jpg",
          popularity: 1,
        },
        {
          id: 11,
          media_type: "person",
          name: "Famous Star",
          profile_path: "/star.jpg",
          popularity: 80,
        },
      ],
    });

    const results = await searchAll("block");

    expect(results.media.map((item) => item.title)).toEqual([
      "Blockbuster",
      "Obscure Film",
    ]);
    expect(results.people.map((person) => person.name)).toEqual([
      "Famous Star",
      "Unknown Extra",
    ]);
  });

  test("getMediaCredits normalizes cast name and character", async () => {
    globalThis.fetch = mockFetch({
      cast: [
        {
          id: 17419,
          name: "Bryan Cranston",
          character: "Walter White",
          profile_path: "/bryan.jpg",
        },
      ],
    });

    const cast = await getMediaCredits("tv", 1396);

    expect(cast).toHaveLength(1);
    expect(cast[0]).toMatchObject({
      id: 17419,
      name: "Bryan Cranston",
      character: "Walter White",
      profileUrl: "https://image.tmdb.org/t/p/w500/bryan.jpg",
    });
    expect(String(globalThis.fetch.mock.calls[0]?.[0])).toContain("/tv/1396/aggregate_credits");
  });

  test("getPersonDetails deduplicates repeated credits for the same title", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/combined_credits")
        ? {
            cast: [
              {
                id: 2093,
                media_type: "tv",
                name: "The X-Files",
                overview: "FBI agents investigate paranormal cases.",
                poster_path: "/xfiles.jpg",
                backdrop_path: "/xfiles-bg.jpg",
                first_air_date: "1993-09-10",
                vote_average: 8.5,
                character: "Dr. Blockhead",
                popularity: 10,
              },
              {
                id: 2093,
                media_type: "tv",
                name: "The X-Files",
                overview: "FBI agents investigate paranormal cases.",
                poster_path: "/xfiles.jpg",
                backdrop_path: "/xfiles-bg.jpg",
                first_air_date: "1993-09-10",
                vote_average: 8.5,
                character: "Guest Star",
                popularity: 5,
              },
            ],
          }
        : {
            id: 17419,
            name: "Bryan Cranston",
            biography: "American actor.",
            profile_path: "/bryan.jpg",
          };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const person = await getPersonDetails(17419);

    expect(person?.filmography).toHaveLength(1);
    expect(person?.knownFor).toHaveLength(1);
    expect(person?.filmography[0]).toMatchObject({
      id: 2093,
      mediaType: "tv",
      title: "The X-Files",
      character: "Dr. Blockhead",
    });
  });

  test("getPersonDetails boosts biography-mentioned titles in knownFor", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/combined_credits")
        ? {
            cast: [
              {
                id: 1,
                media_type: "movie",
                title: "Minor Movie",
                overview: "Small role",
                poster_path: "/minor.jpg",
                backdrop_path: "/minor-bg.jpg",
                release_date: "2010-01-01",
                vote_average: 5,
                character: "Extra",
                popularity: 2,
              },
              {
                id: 2,
                media_type: "tv",
                name: "Famous Show",
                overview: "Hit series",
                poster_path: "/famous.jpg",
                backdrop_path: "/famous-bg.jpg",
                first_air_date: "2008-01-20",
                vote_average: 9,
                character: "Lead",
                popularity: 50,
              },
            ],
          }
        : {
            id: 99,
            name: "Test Actor",
            biography:
              "Test Actor is best known for Minor Movie (2010), but also appeared in many shows.",
            profile_path: "/actor.jpg",
          };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const person = await getPersonDetails(99);

    expect(person?.knownFor).toHaveLength(2);
    expect(person?.knownFor[0]?.title).toBe("Minor Movie");
    expect(person?.knownFor[1]?.title).toBe("Famous Show");
  });

  test("getPersonDetails picks knownFor by popularity", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/combined_credits")
        ? {
            cast: [
              {
                id: 1,
                media_type: "movie",
                title: "Minor Movie",
                overview: "Small role",
                poster_path: "/minor.jpg",
                backdrop_path: "/minor-bg.jpg",
                release_date: "2010-01-01",
                vote_average: 5,
                character: "Extra",
                popularity: 2,
              },
              {
                id: 2,
                media_type: "tv",
                name: "Famous Show",
                overview: "Hit series",
                poster_path: "/famous.jpg",
                backdrop_path: "/famous-bg.jpg",
                first_air_date: "2008-01-20",
                vote_average: 9,
                character: "Lead",
                popularity: 50,
              },
            ],
          }
        : {
            id: 99,
            name: "Test Actor",
            biography: "Actor bio.",
            profile_path: "/actor.jpg",
          };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const person = await getPersonDetails(99);

    expect(person?.knownFor).toHaveLength(2);
    expect(person?.knownFor[0]?.title).toBe("Famous Show");
    expect(person?.knownFor[1]?.title).toBe("Minor Movie");
  });

  test("getPersonDetails loads biography and filmography", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/combined_credits")
        ? {
            cast: [
              {
                id: 1396,
                media_type: "tv",
                name: "Breaking Bad",
                overview: "A chemistry teacher cooks meth.",
                poster_path: "/bb.jpg",
                backdrop_path: "/bb-bg.jpg",
                first_air_date: "2008-01-20",
                vote_average: 8.9,
                character: "Walter White",
                popularity: 100,
              },
            ],
          }
        : {
            id: 17419,
            name: "Bryan Cranston",
            biography: "American actor.",
            birthday: "1956-03-07",
            profile_path: "/bryan.jpg",
          };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const person = await getPersonDetails(17419);

    expect(person).toMatchObject({
      id: 17419,
      name: "Bryan Cranston",
      biography: "American actor.",
      birthday: "1956-03-07",
      profileUrl: "https://image.tmdb.org/t/p/w500/bryan.jpg",
    });
    expect(person?.filmography).toHaveLength(1);
    expect(person?.knownFor).toHaveLength(1);
    expect(person?.filmography[0]).toMatchObject({
      id: 1396,
      mediaType: "tv",
      title: "Breaking Bad",
      character: "Walter White",
      year: 2008,
    });
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
      releaseDate: "2024-05-01",
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

  test("discoverMedia filters by watch provider and region", async () => {
    globalThis.fetch = mockFetch({
      results: [
        {
          id: 8,
          title: "Netflix Hit",
          overview: "Overview",
          poster_path: "/n.jpg",
          backdrop_path: "/nb.jpg",
          release_date: "2024-02-01",
          vote_average: 7.8,
        },
      ],
    });

    const results = await discoverMedia("movie", { watchProviderId: 8 });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Netflix Hit");
    const url = String(globalThis.fetch.mock.calls[0]?.[0]);
    expect(url).toContain("/discover/movie");
    expect(url).toContain("with_watch_providers=8");
    expect(url).toContain("watch_region=CA");
    expect(url).toContain("with_watch_monetization_types=flatrate");
    expect(url).toContain("sort_by=popularity.desc");
  });

  test("buildHomeCatalogRows pins streaming shelves around Popular Movies", async () => {
    const { buildHomeCatalogRows, WATCH_PROVIDER_IDS } = await import("@jedflix/tmdb");
    const rows = buildHomeCatalogRows();
    const titles = rows.map((row) => row.title);

    expect(titles.slice(0, 5)).toEqual([
      "Netflix",
      "Disney+",
      "Popular Movies",
      "Crave",
      "Apple TV+",
    ]);
    expect(rows[0]?.watchProviderId).toBe(WATCH_PROVIDER_IDS.netflix);
    expect(rows[1]?.watchProviderId).toBe(WATCH_PROVIDER_IDS.disneyPlus);
    expect(rows[2]?.genreId).toBeUndefined();
    expect(rows[3]?.watchProviderId).toBe(WATCH_PROVIDER_IDS.crave);
    expect(rows[4]?.watchProviderId).toBe(WATCH_PROVIDER_IDS.appleTvPlus);
    expect(titles).toContain("Action Movies");
    expect(titles).toContain("Popular Shows");
  });

  test("buildMediaCatalogRows adds providers on movies and shows pages", async () => {
    const { buildMediaCatalogRows } = await import("@jedflix/tmdb");
    const movieTitles = buildMediaCatalogRows("movie").map((row) => row.title);
    const tvTitles = buildMediaCatalogRows("tv").map((row) => row.title);

    expect(movieTitles.slice(0, 5)).toEqual([
      "Netflix",
      "Disney+",
      "Popular Movies",
      "Crave",
      "Apple TV+",
    ]);
    expect(tvTitles.slice(0, 5)).toEqual([
      "Netflix",
      "Disney+",
      "Popular Shows",
      "Crave",
      "Apple TV+",
    ]);
    expect(movieTitles).toContain("Horror Movies");
    expect(tvTitles).toContain("Reality Shows");
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

  test("tmdbFetch throws when the backend URL is missing", async () => {
    const { configureTmdb } = await import("@jedflix/tmdb");
    configureTmdb({ backendBaseUrl: "" });

    globalThis.fetch = mockFetch({ results: [] });

    await expect(searchMedia("anything")).rejects.toThrow("Missing TMDB backend URL");

    configureTmdb({ backendBaseUrl: "/backend" });
  });

  test("tmdbFetch throws on non-OK responses", async () => {
    globalThis.fetch = mockFetch({ status_message: "Invalid API key" }, 401);

    await expect(searchMedia("anything")).rejects.toThrow("TMDB request failed: 401");
  });

  test("session cache reuses TMDB responses within the same session", async () => {
    const fetchMock = mockFetch({
      results: [
        {
          id: 1,
          media_type: "movie",
          title: "Cached Movie",
          overview: "Overview",
          poster_path: "/poster.jpg",
          backdrop_path: "/backdrop.jpg",
          release_date: "2024-01-01",
          vote_average: 8,
        },
      ],
    });
    globalThis.fetch = fetchMock;

    const first = await getTrendingMedia();
    const second = await getTrendingMedia();

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(peekTrendingMedia()?.[0]?.title).toBe("Cached Movie");
  });

  test("session cache peeks discover results without refetching", async () => {
    const fetchMock = mockFetch({
      results: [
        {
          id: 28,
          title: "Action Hit",
          overview: "Overview",
          poster_path: "/a.jpg",
          backdrop_path: "/b.jpg",
          release_date: "2023-06-01",
          vote_average: 7.1,
        },
      ],
    });
    globalThis.fetch = fetchMock;

    await discoverMedia("movie", { genreId: 28 });
    expect(peekDiscoverMedia("movie", { genreId: 28 })?.[0]?.title).toBe("Action Hit");

    await discoverMedia("movie", { genreId: 28 });
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  test("failed TMDB requests are not cached", async () => {
    const failing = mockFetch({ status_message: "boom" }, 500);
    globalThis.fetch = failing;

    await expect(discoverMedia("movie")).rejects.toThrow("TMDB request failed: 500");
    expect(peekDiscoverMedia("movie")).toBeUndefined();

    globalThis.fetch = mockFetch({
      results: [
        {
          id: 2,
          title: "Recovered",
          overview: "Overview",
          poster_path: "/p.jpg",
          backdrop_path: "/d.jpg",
          release_date: "2022-01-01",
          vote_average: 6,
        },
      ],
    });

    const recovered = await discoverMedia("movie");
    expect(recovered[0]?.title).toBe("Recovered");
  });
});
