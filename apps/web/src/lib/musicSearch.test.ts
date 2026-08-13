import { describe, expect, test } from "bun:test";
import {
  applyServerMusicRanking,
  mergeMusicSearchTracks,
  normalizeMusicDedupeKey,
  rankMusicSearchResults,
  scoreMusicNameMatch,
  shuffleItems,
  youtubeHitToSearchTrack,
  type MusicSearchTrack,
} from "@/lib/musicSearch";

function spotifyTrack(partial: Partial<MusicSearchTrack> & Pick<MusicSearchTrack, "id" | "name">): MusicSearchTrack {
  return {
    artists: ["Radiohead"],
    artistIds: ["artist1"],
    trackNumber: 1,
    discNumber: 1,
    durationMs: 260_000,
    explicit: false,
    albumId: "album1",
    albumName: "OK Computer",
    imageUrl: "https://img/spotify.jpg",
    source: "spotify",
    ...partial,
  };
}

describe("musicSearch merge", () => {
  test("normalizeMusicDedupeKey ignores official audio noise", () => {
    expect(normalizeMusicDedupeKey(["Radiohead"], "Karma Police (Official Audio)")).toBe(
      normalizeMusicDedupeKey(["radiohead"], "Karma Police"),
    );
  });

  test("merge prefers Spotify when title+artist match YouTube", () => {
    const merged = mergeMusicSearchTracks(
      [spotifyTrack({ id: "sp1", name: "Karma Police" })],
      [
        youtubeHitToSearchTrack({
          id: "yt:abc",
          videoId: "abc",
          name: "Karma Police (Official Audio)",
          artists: ["Radiohead"],
          albumName: "YouTube",
          imageUrl: "https://img/yt.jpg",
          durationMs: 262_000,
        }),
        youtubeHitToSearchTrack({
          id: "yt:obscure",
          videoId: "obscure",
          name: "Obscure B-Side",
          artists: ["Radiohead"],
          albumName: "YouTube",
          imageUrl: "https://img/yt2.jpg",
          durationMs: 180_000,
        }),
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.id).toBe("sp1");
    expect(merged[0]?.source).toBe("spotify");
    expect(merged[1]?.id).toBe("yt:obscure");
    expect(merged[1]?.source).toBe("youtube");
    expect(merged[1]?.youtubeVideoId).toBe("obscure");
  });
});

describe("musicSearch relevance", () => {
  test("exact title beats higher-popularity partial match", () => {
    const exact = scoreMusicNameMatch("thriller", "Thriller", 55);
    const loose = scoreMusicNameMatch("thriller", "Thriller Night Live", 99);
    expect(exact).toBeGreaterThan(loose);
  });

  test("rankMusicSearchResults puts Thriller album above loose artist hits", () => {
    const ranked = rankMusicSearchResults("thriller", {
      tracks: [spotifyTrack({ id: "t1", name: "Thriller Mashup" })],
      albums: [
        {
          id: "album-thriller",
          name: "Thriller",
          artists: ["Michael Jackson"],
          artistIds: ["mj"],
          imageUrl: "https://img/thriller.jpg",
          year: 1982,
          genres: [],
          popularity: 90,
        },
        {
          id: "album-other",
          name: "Thriller Karaoke",
          artists: ["Various"],
          artistIds: ["v"],
          imageUrl: "https://img/k.jpg",
          year: 2000,
          genres: [],
          popularity: 20,
        },
      ],
      artists: [
        {
          id: "artist-tribute",
          name: "Thriller Tribute Band",
          imageUrl: "https://img/a.jpg",
          genres: [],
          popularity: 40,
        },
      ],
    });

    expect(ranked[0]?.kind).toBe("album");
    if (ranked[0]?.kind === "album") {
      expect(ranked[0].album.id).toBe("album-thriller");
    }
  });

  test("shuffleItems keeps the same members", () => {
    const input = [1, 2, 3, 4, 5];
    const shuffled = shuffleItems(input);
    expect(shuffled).toHaveLength(5);
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  test("applyServerMusicRanking keeps backend order instead of re-scoring", () => {
    const ranked = applyServerMusicRanking("beat", {
      tracks: [
        spotifyTrack({ id: "t-beatles", name: "Let It Be", artists: ["The Beatles"] }),
        spotifyTrack({ id: "t-beat-it", name: "Beat It", artists: ["Michael Jackson"] }),
      ],
      albums: [],
      artists: [
        {
          id: "a-beatles",
          name: "The Beatles",
          imageUrl: "https://img/b.jpg",
          genres: [],
          popularity: 99,
        },
      ],
      ranked: [
        { kind: "track", id: "t-beat-it", score: 0.9 },
        { kind: "artist", id: "a-beatles", score: 0.4 },
        { kind: "track", id: "t-beatles", score: 0.2 },
      ],
    });
    expect(ranked.map((hit) => {
      if (hit.kind === "track") {
        return `track:${hit.track.id}`;
      }
      if (hit.kind === "album") {
        return `album:${hit.album.id}`;
      }
      return `artist:${hit.artist.id}`;
    })).toEqual(["track:t-beat-it", "artist:a-beatles", "track:t-beatles"]);
  });
});
