import { describe, expect, test } from "bun:test";
import {
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
      return new Response(null, { status: 200 });
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
    expect(first.sort()).toEqual(["1", "2"]);
    expect(methods).toEqual(["HEAD", "HEAD"]);
    expect(urls.every((url) => url.includes("/youtube/audio?"))).toBe(true);

    const second = await prefetchYoutubeAudioTracks(tracks, {
      fetchImpl,
      alreadyPrefetched: warmed,
    });
    expect(second).toEqual([]);
    expect(methods).toHaveLength(2);
  });

  test("prefetchYoutubeAudioTracks prefers shared youtubeVideoId URLs", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(null, { status: 200 });
    };

    await prefetchYoutubeAudioTracks(
      [
        {
          id: "1",
          title: "Song One",
          artists: ["Artist"],
          albumName: "Album",
          durationMs: 180_000,
          youtubeVideoId: "dQw4w9WgXcQ",
        },
      ],
      { fetchImpl },
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("videoId=dQw4w9WgXcQ");
    expect(urls[0]).not.toContain("artist=");
  });
});
