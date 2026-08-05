import { describe, expect, test } from "bun:test";
import {
  mergeMusicSearchTracks,
  normalizeMusicDedupeKey,
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
