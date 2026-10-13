import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  isExternalHttpUrl,
  resetExternalLinkHandlerForTests,
  shouldOpenExternalInSystemBrowser,
  toSystemBrowserUrl,
} from "@/lib/openExternalUrl";

describe("openExternalUrl", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("standalone"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    resetExternalLinkHandlerForTests();
    delete (navigator as unknown as Record<string, unknown>).standalone;
  });

  test("rewrites https URLs to the Safari scheme", () => {
    expect(toSystemBrowserUrl("https://real-debrid.com/apitoken")).toBe(
      "x-safari-https://real-debrid.com/apitoken",
    );
  });

  test("rewrites http URLs to the Safari scheme", () => {
    expect(toSystemBrowserUrl("http://example.com")).toBe("x-safari-http://example.com");
  });

  test("leaves non-http URLs unchanged", () => {
    expect(toSystemBrowserUrl("vlc://stream")).toBe("vlc://stream");
  });

  test("detects external http URLs", () => {
    expect(isExternalHttpUrl("https://real-debrid.com/apitoken", "https://jedflix.example")).toBe(
      true,
    );
    expect(isExternalHttpUrl("/settings", "https://jedflix.example")).toBe(false);
    expect(isExternalHttpUrl("https://jedflix.example/watch", "https://jedflix.example")).toBe(
      false,
    );
  });

  test("opens external links in Safari when running as an iOS PWA", () => {
    expect(shouldOpenExternalInSystemBrowser()).toBe(true);
  });
});
