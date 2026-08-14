import { describe, expect, test } from "bun:test";
import {
  fetchYoutubeAudioMetadata,
  prefetchYoutubeAudioTracks,
  upcomingTracksForPrefetch,
} from "@/lib/youtubeAudioPrefetch";

describe("youtubeAudioPrefetch", () => {
  test("upcomingTracksForPrefetch returns the next two tracks", () => {
    const queue = ["a", "b", "c", "d", "e"];
    expect(upcomingTracksForPrefetch(queue, 1, 2)).toEqual(["c", "d"]);
    expect(upcomingTracksForPrefetch(queue, 3, 2)).toEqual(["e"]);
    expect(upcomingTracksForPrefetch(queue, 4, 2)).toEqual([]);
  });

  test("prefetchYoutubeAudioTracks issues HEAD requests and skips duplicates", async () => {
    const urls: string[] = [];
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      urls.push(String(input));
      methods.push(init?.method ?? "GET");
      return new Response(null, {
        status: 200,
        headers: { "X-Audio-Duration-Ms": "181000" },
      });
    };

    const tracks = [
      {
        id: "1",
        title: "Song One",
        artists: ["Artist"],
        albumName: "Album",
        durationMs: 180_000,
      },
      {
        id: "2",
        title: "Song Two",
        artists: ["Artist"],
        albumName: "Album",
        durationMs: 200_000,
      },
    ];

    const warmed = new Set<string>();
    const first = await prefetchYoutubeAudioTracks(tracks, {
      fetchImpl,
      alreadyPrefetched: warmed,
    });
    expect(first.warmed.sort()).toEqual(["1", "2"]);
    expect(first.durationMsByTrackId).toEqual({ "1": 181000, "2": 181000 });
    expect(methods).toEqual(["HEAD", "HEAD"]);
    expect(urls.every((url) => url.includes("/youtube/audio?"))).toBe(true);

    const second = await prefetchYoutubeAudioTracks(tracks, {
      fetchImpl,
      alreadyPrefetched: warmed,
    });
    expect(second.warmed).toEqual([]);
    expect(methods).toHaveLength(2);
  });

  test("prefetchYoutubeAudioTracks stops after a 429 so playback can use the slot", async () => {
    const statuses = [429, 200];
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      const status = statuses[calls] ?? 200;
      calls += 1;
      return new Response(null, { status });
    };
    const result = await prefetchYoutubeAudioTracks(
      [
        {
          id: "1",
          title: "Song One",
          artists: ["Artist"],
          albumName: "Album",
          durationMs: 180_000,
        },
        {
          id: "2",
          title: "Song Two",
          artists: ["Artist"],
          albumName: "Album",
          durationMs: 200_000,
        },
      ],
      { fetchImpl },
    );
    expect(result.warmed).toEqual([]);
    expect(calls).toBe(1);
  });

  test("fetchYoutubeAudioMetadata reads duration from HEAD", async () => {
    const meta = await fetchYoutubeAudioMetadata("https://example/audio", {
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
          headers: { "X-Audio-Duration-Ms": "210000", "X-Audio-Ext": "m4a" },
        }),
    });
    expect(meta).toEqual({ durationMs: 210000, ext: "m4a" });
  });
});
