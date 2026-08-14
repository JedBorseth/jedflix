import { describe, expect, test } from "bun:test";
import {
  looksLikeLiveRecording,
  youtubeAudioQueryHints,
} from "./liveRecording";

describe("looksLikeLiveRecording", () => {
  test("detects concert and bootleg titles", () => {
    expect(
      looksLikeLiveRecording(
        "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
      ),
    ).toBe(true);
    expect(
      looksLikeLiveRecording(
        "Live at the Masonic Temple, October 2nd, 2005, Detroit, MI",
      ),
    ).toBe(true);
    expect(looksLikeLiveRecording("Doolittle Live")).toBe(true);
    expect(looksLikeLiveRecording("Bone Machine (Live)")).toBe(true);
    expect(looksLikeLiveRecording("Seven Nation Army - Live")).toBe(true);
  });

  test("keeps studio titles that contain the word live", () => {
    expect(looksLikeLiveRecording("Live Through This")).toBe(false);
    expect(looksLikeLiveRecording("Live and Let Die")).toBe(false);
    expect(looksLikeLiveRecording("Alive")).toBe(false);
    expect(looksLikeLiveRecording("Doolittle")).toBe(false);
    expect(looksLikeLiveRecording("")).toBe(false);
  });
});

describe("youtubeAudioQueryHints", () => {
  test("drops live album name and duration so studio YouTube matches can win", () => {
    expect(
      youtubeAudioQueryHints({
        title: "Bone Machine",
        albumName:
          "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
        durationMs: 340_000,
      }),
    ).toEqual({});
  });

  test("keeps studio album hints", () => {
    expect(
      youtubeAudioQueryHints({
        title: "Bone Machine",
        albumName: "Doolittle",
        durationMs: 183_000,
      }),
    ).toEqual({ album: "Doolittle", durationMs: 183_000 });
  });

  test("keeps duration when the track title itself is a live recording", () => {
    expect(
      youtubeAudioQueryHints({
        title: "Bone Machine (Live)",
        albumName: "Doolittle Live",
        durationMs: 340_000,
      }),
    ).toEqual({ album: "Doolittle Live", durationMs: 340_000 });
  });
});
