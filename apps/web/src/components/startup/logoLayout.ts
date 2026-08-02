/**
 * Shared layout constants for the Jedflix startup wordmark.
 * SVG `x` values are the FINAL centered layout; the timeline starts the J at
 * VIEWBOX_CENTER_X, then slides it left as trailing letters unfold.
 */

export const STARTUP_LOGO_VIEWBOX = "0 0 720 180";
export const VIEWBOX_CENTER_X = 360;

/** Trailing letters that unfold from behind the lead J. */
export const TRAILING_LETTERS = ["e", "d", "f", "l", "i", "x"] as const;

export type TrailingLetter = (typeof TRAILING_LETTERS)[number];

/**
 * Final horizontal centers for J + trailing letters (viewBox units).
 * Tight kerning; full word midpoint ≈ VIEWBOX_CENTER_X.
 */
export const LETTER_X = {
  J: 230,
  e: 280,
  d: 330,
  f: 374,
  l: 408,
  i: 438,
  x: 484,
} as const;

export const LETTER_BASELINE_Y = 118;

/** Pixel offset that places a letter's final x at the viewBox center. */
export function offsetToCenter(letterX: number) {
  return VIEWBOX_CENTER_X - letterX;
}
