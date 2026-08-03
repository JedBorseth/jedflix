import { afterEach, describe, expect, test } from "bun:test";
import {
  clearUserSettings,
  getUserSettings,
  hasRealDebridApiKey,
  hasRequiredOnboardingFields,
  isOnboardingComplete,
  sanitizeSettings,
  saveUserSettings,
  withoutDebridContentTypes,
} from "@/lib/userSettings";
import {
  isContentTypeLockedWithoutDebrid,
  toggleContentType,
  validateOnboardingStep,
  validateOnboardingValues,
} from "@/lib/settingsForm";

afterEach(() => {
  clearUserSettings();
});

describe("userSettings onboarding fields", () => {
  test("sanitizeSettings keeps valid onboarding fields", () => {
    const sanitized = sanitizeSettings({
      deviceType: "tv",
      contentTypes: ["movies_shows", "audiobooks", "music", "not-real" as never],
      letterboxdUsername: "  jed  ",
      virusWarningAccepted: true,
      ispWarningAccepted: false,
      onboardingCompleted: true,
      externalPlayer: "vlc",
      realDebridApiKey: "token",
    });

    expect(sanitized).toEqual({
      realDebridApiKey: "token",
      externalPlayer: "vlc",
      deviceType: "tv",
      contentTypes: ["movies_shows", "audiobooks", "music"],
      letterboxdUsername: "jed",
      virusWarningAccepted: true,
      ispWarningAccepted: false,
      onboardingCompleted: true,
      updatedAt: undefined,
    });
  });

  test("isOnboardingComplete requires flag and required fields", () => {
    expect(isOnboardingComplete({})).toBe(false);

    saveUserSettings({
      deviceType: "mobile",
      contentTypes: ["video_games"],
      realDebridApiKey: "abc",
      externalPlayer: "outplayer",
      virusWarningAccepted: true,
      ispWarningAccepted: true,
      onboardingCompleted: true,
    });

    expect(hasRequiredOnboardingFields(getUserSettings())).toBe(true);
    expect(isOnboardingComplete(getUserSettings())).toBe(true);
  });

  test("music-only onboarding completes without a Real Debrid key", () => {
    saveUserSettings({
      deviceType: "desktop",
      contentTypes: ["music"],
      externalPlayer: "disabled",
      virusWarningAccepted: true,
      ispWarningAccepted: true,
      onboardingCompleted: true,
    });

    expect(hasRealDebridApiKey(getUserSettings())).toBe(false);
    expect(hasRequiredOnboardingFields(getUserSettings())).toBe(true);
    expect(isOnboardingComplete(getUserSettings())).toBe(true);
  });

  test("movies require a Real Debrid key to complete onboarding", () => {
    saveUserSettings({
      deviceType: "desktop",
      contentTypes: ["movies_shows"],
      externalPlayer: "disabled",
      virusWarningAccepted: true,
      ispWarningAccepted: true,
      onboardingCompleted: true,
    });

    expect(hasRequiredOnboardingFields(getUserSettings())).toBe(false);
    expect(isOnboardingComplete(getUserSettings())).toBe(false);
  });

  test("clearUserSettings removes onboarding completion", () => {
    saveUserSettings({
      deviceType: "desktop",
      contentTypes: ["movies_shows"],
      realDebridApiKey: "abc",
      externalPlayer: "disabled",
      virusWarningAccepted: true,
      ispWarningAccepted: true,
      onboardingCompleted: true,
    });
    clearUserSettings();
    expect(getUserSettings()).toEqual({});
    expect(isOnboardingComplete()).toBe(false);
  });
});

describe("settingsForm helpers", () => {
  test("validateOnboardingValues requires acknowledgements and key fields", () => {
    expect(
      validateOnboardingValues({
        deviceType: "",
        contentTypes: [],
        realDebridApiKey: "",
        externalPlayer: "",
        letterboxdUsername: "",
        virusWarningAccepted: false,
        ispWarningAccepted: false,
      }),
    ).toBe("Select a device type.");

    expect(
      validateOnboardingValues({
        deviceType: "desktop",
        contentTypes: ["movies_shows"],
        realDebridApiKey: "key",
        externalPlayer: "vlc",
        letterboxdUsername: "jed",
        virusWarningAccepted: true,
        ispWarningAccepted: true,
      }),
    ).toBeUndefined();

    expect(
      validateOnboardingValues({
        deviceType: "desktop",
        contentTypes: ["music"],
        realDebridApiKey: "",
        externalPlayer: "disabled",
        letterboxdUsername: "",
        virusWarningAccepted: true,
        ispWarningAccepted: true,
      }),
    ).toBeUndefined();
  });

  test("validateOnboardingStep blocks debrid content without a key", () => {
    expect(
      validateOnboardingStep("contentTypes", {
        deviceType: "desktop",
        contentTypes: ["movies_shows"],
        realDebridApiKey: "",
        externalPlayer: "disabled",
        letterboxdUsername: "",
        virusWarningAccepted: false,
        ispWarningAccepted: false,
      }),
    ).toBe(
      "Movies, shows, audiobooks, and games need a Real Debrid key. Select Music, or go back and add a key.",
    );

    expect(
      validateOnboardingStep("realDebridApiKey", {
        deviceType: "desktop",
        contentTypes: [],
        realDebridApiKey: "",
        externalPlayer: "",
        letterboxdUsername: "",
        virusWarningAccepted: false,
        ispWarningAccepted: false,
      }),
    ).toBeUndefined();
  });

  test("validateOnboardingStep checks one question at a time", () => {
    const empty = {
      deviceType: "" as const,
      contentTypes: [],
      realDebridApiKey: "",
      externalPlayer: "" as const,
      letterboxdUsername: "",
      virusWarningAccepted: false,
      ispWarningAccepted: false,
    };
    expect(validateOnboardingStep("welcome", empty)).toBeUndefined();
    expect(validateOnboardingStep("letterboxdUsername", empty)).toBeUndefined();
    expect(validateOnboardingStep("deviceType", empty)).toBe("Select a device type.");
    expect(
      validateOnboardingStep("virusWarning", { ...empty, virusWarningAccepted: true }),
    ).toBeUndefined();
  });

  test("toggleContentType adds and removes values", () => {
    expect(toggleContentType([], "audiobooks", true)).toEqual(["audiobooks"]);
    expect(toggleContentType(["audiobooks", "video_games"], "audiobooks", false)).toEqual([
      "video_games",
    ]);
  });

  test("debrid content types lock without a key", () => {
    expect(isContentTypeLockedWithoutDebrid("movies_shows", "")).toBe(true);
    expect(isContentTypeLockedWithoutDebrid("audiobooks", "  ")).toBe(true);
    expect(isContentTypeLockedWithoutDebrid("video_games", "")).toBe(true);
    expect(isContentTypeLockedWithoutDebrid("music", "")).toBe(false);
    expect(isContentTypeLockedWithoutDebrid("movies_shows", "key")).toBe(false);
    expect(withoutDebridContentTypes(["movies_shows", "music", "audiobooks", "video_games"])).toEqual(
      ["music"],
    );
  });
});
