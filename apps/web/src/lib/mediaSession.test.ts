import { describe, expect, test } from "bun:test";
import {
  artworkFromImageUrl,
  formatWatchSessionTitle,
  isPlayAbortError,
  playMediaElement,
  toAbsoluteMediaUrl,
} from "./mediaSession";

describe("toAbsoluteMediaUrl", () => {
  test("resolves relative paths against origin", () => {
    expect(toAbsoluteMediaUrl("/pwa-512x512.png", "https://jedflix.example")).toBe(
      "https://jedflix.example/pwa-512x512.png",
    );
  });

  test("keeps absolute URLs", () => {
    expect(toAbsoluteMediaUrl("https://cdn.example/cover.jpg", "https://jedflix.example")).toBe(
      "https://cdn.example/cover.jpg",
    );
  });
});

describe("artworkFromImageUrl", () => {
  test("falls back to PWA icons when missing", () => {
    const artwork = artworkFromImageUrl(null, "https://jedflix.example");
    expect(artwork).toEqual([
      {
        src: "https://jedflix.example/pwa-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "https://jedflix.example/pwa-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ]);
  });

  test("expands TMDB poster sizes", () => {
    const artwork = artworkFromImageUrl(
      "https://image.tmdb.org/t/p/w500/poster.jpg",
      "https://jedflix.example",
    );
    expect(artwork.map((item) => item.src)).toEqual([
      "https://image.tmdb.org/t/p/w185/poster.jpg",
      "https://image.tmdb.org/t/p/w342/poster.jpg",
      "https://image.tmdb.org/t/p/w500/poster.jpg",
    ]);
  });

  test("uses cover URL for books", () => {
    const artwork = artworkFromImageUrl(
      "/backend/api/v1/openlibrary/covers/b/id/1.jpg",
      "https://jedflix.example",
    );
    expect(artwork).toEqual([
      {
        src: "https://jedflix.example/backend/api/v1/openlibrary/covers/b/id/1.jpg",
        sizes: "512x512",
        type: "image/jpeg",
      },
    ]);
  });
});

describe("formatWatchSessionTitle", () => {
  test("formats TV episode labels", () => {
    expect(formatWatchSessionTitle("The X-Files", "tv", 1, 2)).toBe("The X-Files · S01E02");
  });

  test("keeps movie titles plain", () => {
    expect(formatWatchSessionTitle("Inception", "movie")).toBe("Inception");
  });
});

describe("isPlayAbortError", () => {
  test("detects AbortError and aborted messages", () => {
    expect(isPlayAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(
      true,
    );
    expect(isPlayAbortError(new Error("The operation was aborted."))).toBe(true);
    expect(
      isPlayAbortError(
        new DOMException(
          "The play() request was interrupted by a call to pause().",
          "AbortError",
        ),
      ),
    ).toBe(true);
    expect(isPlayAbortError(new Error("NotAllowedError"))).toBe(false);
  });
});

describe("playMediaElement", () => {
  test("returns playing when play resolves and element is not paused", async () => {
    const media = {
      paused: false,
      play: async () => undefined,
    } as unknown as HTMLMediaElement;
    await expect(playMediaElement(media)).resolves.toEqual({ status: "playing" });
  });

  test("returns aborted when play resolves but element is paused", async () => {
    const media = {
      paused: true,
      play: async () => undefined,
    } as unknown as HTMLMediaElement;
    await expect(playMediaElement(media)).resolves.toEqual({ status: "aborted" });
  });

  test("returns aborted for AbortError without treating it as playing", async () => {
    const media = {
      paused: true,
      play: async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    } as unknown as HTMLMediaElement;
    await expect(playMediaElement(media)).resolves.toEqual({ status: "aborted" });
  });

  test("returns error for NotAllowedError", async () => {
    const media = {
      paused: true,
      play: async () => {
        throw new DOMException("Not allowed", "NotAllowedError");
      },
    } as unknown as HTMLMediaElement;
    const result = await playMediaElement(media);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.name).toBe("NotAllowedError");
    }
  });
});
