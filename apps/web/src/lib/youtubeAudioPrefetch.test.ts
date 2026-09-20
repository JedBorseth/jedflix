import { describe, expect, test } from "bun:test";
import { createStreamClient } from "@jedflix/stream-client";
import { getYoutubeAudioUrl } from "@/lib/spotify";
import {
  fetchYoutubeAudioMetadata,
  neighborTracksForPrefetch,
  prefetchYoutubeAudioTracks,
  shouldPrefetchNeighborAudio,
  upcomingTracksForPrefetch,
} from "@/lib/youtubeAudioPrefetch";

function sampleTrack(id: string, title: string) {
  return {
    id,
    title,
    artists: ["Artist"],
    albumName: "Album",
    durationMs: 180_000,
  };
}

describe("youtubeAudioPrefetch", () => {
  test("upcomingTracksForPrefetch returns the next two tracks", () => {
    const queue = ["a", "b", "c", "d", "e"];
    expect(upcomingTracksForPrefetch(queue, 1, 2)).toEqual(["c", "d"]);
    expect(upcomingTracksForPrefetch(queue, 3, 2)).toEqual(["e"]);
    expect(upcomingTracksForPrefetch(queue, 4, 2)).toEqual([]);
  });

  test("neighborTracksForPrefetch returns previous one and next two", () => {
    const queue = ["a", "b", "c", "d", "e"];
    expect(neighborTracksForPrefetch(queue, 0)).toEqual(["b", "c"]);
    expect(neighborTracksForPrefetch(queue, 1)).toEqual(["a", "c", "d"]);
    expect(neighborTracksForPrefetch(queue, 4)).toEqual(["d"]);
    expect(neighborTracksForPrefetch(queue, 4, ["x", "y"])).toEqual([
      "d",
      "x",
      "y",
    ]);
    expect(neighborTracksForPrefetch(queue, 3, ["x"])).toEqual(["c", "e", "x"]);
  });

  test("shouldPrefetchNeighborAudio waits for audible playing, not loading=false", () => {
    expect(shouldPrefetchNeighborAudio({ playing: false })).toBe(false);
    expect(shouldPrefetchNeighborAudio({ playing: true })).toBe(true);
  });

  test("getYoutubeAudioUrl prefetch flag is opt-in", () => {
    const client = createStreamClient({ apiBase: "/backend" });
    const playback = client.getYoutubeAudioUrl({
      artist: "Pixies",
      title: "Debaser",
    });
    const prefetch = client.getYoutubeAudioUrl({
      artist: "Pixies",
      title: "Debaser",
      prefetch: true,
    });
    expect(playback).toContain("/youtube/audio?");
    expect(playback).not.toContain("prefetch=");
    expect(prefetch).toContain("prefetch=1");
    expect(
      getYoutubeAudioUrl({ artist: "Pixies", title: "Debaser" }),
    ).not.toContain("prefetch=");
  });

  test("prefetchYoutubeAudioTracks issues HEAD requests with prefetch=1 and skips duplicates", async () => {
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

    const tracks = [sampleTrack("1", "Song One"), sampleTrack("2", "Song Two")];

    const warmed = new Set<string>();
    const first = await prefetchYoutubeAudioTracks(tracks, {
      fetchImpl,
      alreadyPrefetched: warmed,
    });
    expect(first.warmed.sort()).toEqual(["1", "2"]);
    expect(first.durationMsByTrackId).toEqual({ "1": 181000, "2": 181000 });
    expect(methods).toEqual(["HEAD", "HEAD"]);
    expect(urls.every((url) => url.includes("/youtube/audio?"))).toBe(true);
    expect(urls.every((url) => url.includes("prefetch=1"))).toBe(true);
    expect(urls[0]).toContain("album=Album");

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
    const seen = new Set<string>();
    const result = await prefetchYoutubeAudioTracks(
      [sampleTrack("1", "Song One"), sampleTrack("2", "Song Two")],
      { fetchImpl, alreadyPrefetched: seen },
    );
    expect(result.warmed).toEqual([]);
    expect(calls).toBe(1);
    expect(seen.has("1")).toBe(false);
  });

  test("failed HEAD is not warmed and stays eligible", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, { status: 500 });
      }
      return new Response(null, { status: 200 });
    };
    const seen = new Set<string>();
    const first = await prefetchYoutubeAudioTracks(
      [sampleTrack("1", "Song One")],
      { fetchImpl, alreadyPrefetched: seen },
    );
    expect(first.warmed).toEqual([]);
    expect(seen.has("1")).toBe(false);

    const second = await prefetchYoutubeAudioTracks(
      [sampleTrack("1", "Song One")],
      { fetchImpl, alreadyPrefetched: seen },
    );
    expect(second.warmed).toEqual(["1"]);
    expect(calls).toBe(2);
  });

  test("omits live album names from the YouTube resolve URL", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(null, { status: 200 });
    };
    await prefetchYoutubeAudioTracks(
      [
        {
          id: "1",
          title: "Bone Machine",
          artists: ["Pixies"],
          albumName:
            "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
          durationMs: 340_000,
        },
      ],
      { fetchImpl },
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("title=Bone+Machine");
    expect(urls[0]).toContain("prefetch=1");
    expect(urls[0]).not.toContain("album=");
    expect(urls[0]).not.toContain("durationMs=");
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
