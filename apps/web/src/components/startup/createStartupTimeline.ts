import gsap from "gsap";
import { LETTER_X, TRAILING_LETTERS, offsetToCenter } from "./logoLayout";

export type StartupTimelineElements = {
  overlay: HTMLElement;
  word: HTMLElement;
  leadLetter: HTMLElement;
  trailingLetters: HTMLElement[];
  bloom: HTMLElement;
  shineBand: HTMLElement;
  softGlowFilter?: SVGFilterElement | null;
};

export type CreateStartupTimelineOptions = {
  reducedMotion?: boolean;
  onIntroComplete?: () => void;
};

/**
 * Master Jedflix startup timeline.
 *
 * Labels:
 * - black
 * - j-emerge   (0.15s) — J centered
 * - j-bloom    (0.70s)
 * - unfold     (0.95s) — J slides left, edflix unfolds; final word centered
 * - word-settle (1.45s)
 * - shine      (1.60s)
 * - glow-fade  (1.95s)
 * - hold
 *
 * Exit is a separate tween driven by the React component when `visible` becomes false.
 */
export function createStartupTimeline(
  elements: StartupTimelineElements,
  options: CreateStartupTimelineOptions = {},
) {
  const {
    overlay,
    word,
    leadLetter,
    trailingLetters,
    bloom,
    shineBand,
  } = elements;

  const jCenterOffset = offsetToCenter(LETTER_X.J);

  const tl = gsap.timeline({
    defaults: {
      ease: "power2.out",
    },
    paused: true,
  });

  if (options.reducedMotion) {
    gsap.set(overlay, { autoAlpha: 1 });
    gsap.set([leadLetter, ...trailingLetters], {
      autoAlpha: 1,
      x: 0,
      scale: 1,
      filter: "blur(0px)",
    });
    gsap.set([bloom, shineBand], { autoAlpha: 0, x: 0 });
    tl.to({}, { duration: 0.35 });
    tl.addLabel("hold");
    tl.call(() => options.onIntroComplete?.());
    return tl;
  }

  // --- Initial state -------------------------------------------------------
  // J (and bloom) sit at the viewBox center; trailing letters are stacked behind it.
  gsap.set(overlay, { autoAlpha: 1 });
  gsap.set(word, { autoAlpha: 1 });
  gsap.set(leadLetter, {
    autoAlpha: 0,
    x: jCenterOffset,
    scale: 0.85,
    filter: "blur(10px)",
    transformOrigin: "50% 50%",
  });
  gsap.set(trailingLetters, {
    autoAlpha: 0,
    x: (_index, target) => {
      const letter = target.getAttribute("data-letter") as (typeof TRAILING_LETTERS)[number];
      return offsetToCenter(LETTER_X[letter]);
    },
    scale: 0.96,
    filter: "blur(6px)",
    transformOrigin: "50% 50%",
  });
  gsap.set(bloom, {
    autoAlpha: 0,
    x: jCenterOffset,
    scale: 0.7,
    transformOrigin: `${LETTER_X.J}px 100px`,
  });
  gsap.set(shineBand, {
    autoAlpha: 0,
    x: 0,
  });

  tl.addLabel("black", 0);

  // 0.15s — J materializes from darkness, centered
  tl.addLabel("j-emerge", 0.15);
  tl.fromTo(
    leadLetter,
    {
      autoAlpha: 0,
      scale: 0.85,
      filter: "blur(10px)",
    },
    {
      autoAlpha: 1,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.55,
      ease: "power3.out",
    },
    "j-emerge",
  );

  tl.fromTo(
    bloom,
    { autoAlpha: 0, scale: 0.65 },
    {
      autoAlpha: 0.55,
      scale: 1,
      duration: 0.55,
      ease: "power2.out",
    },
    "j-emerge",
  );

  // 0.70s — full brightness + soft bloom expand then settle
  tl.addLabel("j-bloom", 0.7);
  tl.to(
    bloom,
    {
      autoAlpha: 0.85,
      scale: 1.55,
      duration: 0.28,
      ease: "power1.out",
    },
    "j-bloom",
  );
  tl.to(
    bloom,
    {
      autoAlpha: 0.4,
      scale: 1.15,
      duration: 0.35,
      ease: "power2.inOut",
    },
    "j-bloom+=0.28",
  );

  // 0.95s — J slides left; edflix unfolds into the centered wordmark
  tl.addLabel("unfold", 0.95);
  tl.to(
    leadLetter,
    {
      x: 0,
      duration: 0.55,
      ease: "power3.inOut",
    },
    "unfold",
  );
  tl.to(
    bloom,
    {
      x: 0,
      duration: 0.55,
      ease: "power3.inOut",
    },
    "unfold",
  );
  tl.to(
    trailingLetters,
    {
      autoAlpha: 1,
      x: 0,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.55,
      stagger: {
        each: 0.04,
        from: "start",
        ease: "power1.out",
      },
      ease: "power3.out",
    },
    "unfold",
  );

  // 1.45s — slight tracking expand, then settle to final kerning
  tl.addLabel("word-settle", 1.45);
  const trackingSpread = trailingLetters.map((_el, index) => 2 + index * 0.75);

  tl.to(
    trailingLetters,
    {
      x: (_i, target) => {
        const index = trailingLetters.indexOf(target as HTMLElement);
        return trackingSpread[index] ?? 2;
      },
      duration: 0.22,
      ease: "power1.out",
      stagger: 0.01,
    },
    "word-settle",
  );
  tl.to(
    trailingLetters,
    {
      x: 0,
      duration: 0.38,
      ease: "power2.inOut",
      stagger: 0.01,
    },
    "word-settle+=0.22",
  );

  // 1.60s — polished metal light sweep (gradient band + mask)
  tl.addLabel("shine", 1.6);
  tl.fromTo(
    shineBand,
    { autoAlpha: 0, x: 0 },
    {
      autoAlpha: 1,
      duration: 0.12,
      ease: "power1.out",
    },
    "shine",
  );
  tl.to(
    shineBand,
    {
      x: 720,
      duration: 0.55,
      ease: "power2.inOut",
    },
    "shine",
  );
  tl.to(
    shineBand,
    {
      autoAlpha: 0,
      duration: 0.18,
      ease: "power1.in",
    },
    "shine+=0.42",
  );

  // 1.95s — glow fades; logo stays sharp
  tl.addLabel("glow-fade", 1.95);
  tl.to(
    bloom,
    {
      autoAlpha: 0,
      scale: 1.05,
      duration: 0.45,
      ease: "power2.out",
    },
    "glow-fade",
  );

  // Brief hold on the finished mark before reporting intro complete
  tl.addLabel("hold", 2.35);
  tl.call(() => options.onIntroComplete?.(), [], "hold");

  return tl;
}

/**
 * Crossfade the overlay out while the app shell fades in.
 * Opacity-only on the shell — never apply transforms, or `position: fixed`
 * descendants (mobile bottom nav) become stuck to the scrolling container.
 */
export function playStartupExit(options: {
  overlay: HTMLElement;
  appShell?: HTMLElement | null;
  onComplete?: () => void;
  reducedMotion?: boolean;
}) {
  const { overlay, appShell, onComplete, reducedMotion } = options;
  const duration = reducedMotion ? 0.2 : 0.55;

  if (appShell) {
    appShell.dataset.startupPending = "false";
    gsap.set(appShell, { opacity: 0, visibility: "visible", clearProps: "transform" });
  }

  const exit = gsap.timeline({
    defaults: { ease: "power2.inOut" },
    onComplete: () => {
      if (appShell) {
        // Ensure no leftover transform creates a fixed-position containing block.
        gsap.set(appShell, { clearProps: "transform,will-change" });
        appShell.style.transform = "";
        appShell.style.willChange = "";
      }
      onComplete?.();
    },
  });

  exit.to(overlay, { autoAlpha: 0, duration }, 0);
  if (appShell) {
    exit.to(appShell, { opacity: 1, duration }, 0);
  }

  return exit;
}
