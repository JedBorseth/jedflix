import { describe, expect, test } from "bun:test";
import {
  artworkFromImageUrl,
  formatWatchSessionTitle,
  isPlayAbortError,
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
      "/stream-api/api/v1/openlibrary/covers/b/id/1.jpg",
      "https://jedflix.example",
    );
    expect(artwork).toEqual([
      {
        src: "https://jedflix.example/stream-api/api/v1/openlibrary/covers/b/id/1.jpg",
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
