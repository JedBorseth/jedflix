import { afterEach, describe, expect, test } from "bun:test";
import gsap from "gsap";
import { LETTER_X, VIEWBOX_CENTER_X, offsetToCenter } from "./logoLayout";
import { createStartupTimeline, playStartupExit } from "./createStartupTimeline";

function requireEl<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) {
    throw new Error(`Missing element: ${selector}`);
  }
  return node as T;
}

function mountOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "startup-overlay";
  overlay.innerHTML = `
    <svg class="startup-logo" viewBox="0 0 720 180">
      <g class="jedflix-bloom" data-startup="bloom"></g>
      <g class="jedflix-word" data-startup="word">
        <g class="jedflix-letter" data-startup="letter-j" data-letter="J"></g>
        <g class="jedflix-letter" data-startup="letter-e" data-letter="e"></g>
        <g class="jedflix-letter" data-startup="letter-d" data-letter="d"></g>
        <g class="jedflix-letter" data-startup="letter-f" data-letter="f"></g>
        <g class="jedflix-letter" data-startup="letter-l" data-letter="l"></g>
        <g class="jedflix-letter" data-startup="letter-i" data-letter="i"></g>
        <g class="jedflix-letter" data-startup="letter-x" data-letter="x"></g>
        <rect data-startup="shine"></rect>
      </g>
    </svg>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function collectElements(overlay: HTMLElement) {
  return {
    overlay,
    word: requireEl<HTMLElement>(overlay, "[data-startup='word']"),
    leadLetter: requireEl<HTMLElement>(overlay, "[data-startup='letter-j']"),
    trailingLetters: ["e", "d", "f", "l", "i", "x"].map((letter) =>
      requireEl<HTMLElement>(overlay, `[data-startup='letter-${letter}']`),
    ),
    bloom: requireEl<HTMLElement>(overlay, "[data-startup='bloom']"),
    shineBand: requireEl<HTMLElement>(overlay, "[data-startup='shine']"),
  };
}

describe("createStartupTimeline", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    gsap.globalTimeline.clear();
  });

  test("final letter layout is centered in the viewBox", () => {
    const mid = (LETTER_X.J + LETTER_X.x) / 2;
    expect(Math.abs(mid - VIEWBOX_CENTER_X)).toBeLessThan(5);
    expect(offsetToCenter(LETTER_X.J)).toBe(VIEWBOX_CENTER_X - LETTER_X.J);
  });

  test("builds a labeled master timeline that reports intro complete at hold", () => {
    const overlay = mountOverlay();
    let complete = false;

    const tl = createStartupTimeline(collectElements(overlay), {
      onIntroComplete: () => {
        complete = true;
      },
    });

    expect(tl.labels["j-emerge"]).toBeDefined();
    expect(tl.labels["j-bloom"]).toBeDefined();
    expect(tl.labels.unfold).toBeDefined();
    expect(tl.labels["word-settle"]).toBeDefined();
    expect(tl.labels.shine).toBeDefined();
    expect(tl.labels["glow-fade"]).toBeDefined();
    expect(tl.labels.hold).toBeDefined();

    tl.progress(1);
    expect(complete).toBe(true);
    tl.kill();
  });

  test("reduced motion path still reaches hold", () => {
    const overlay = mountOverlay();
    let complete = false;

    const tl = createStartupTimeline(collectElements(overlay), {
      reducedMotion: true,
      onIntroComplete: () => {
        complete = true;
      },
    });
    tl.progress(1);
    expect(complete).toBe(true);
    tl.kill();
  });

  test("exit crossfade reveals the app shell without leaving a transform", () => {
    const overlay = mountOverlay();
    const appShell = document.createElement("div");
    appShell.className = "startup-app-shell";
    appShell.dataset.startupPending = "true";
    document.body.appendChild(appShell);

    let done = false;
    const exit = playStartupExit({
      overlay,
      appShell,
      onComplete: () => {
        done = true;
      },
      reducedMotion: true,
    });
    exit.progress(1);

    expect(appShell.dataset.startupPending).toBe("false");
    expect(appShell.style.transform).toBe("");
    expect(done).toBe(true);
    exit.kill();
  });
});
