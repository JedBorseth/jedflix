import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { JedflixLogoSvg } from "./JedflixLogoSvg";
import { TRAILING_LETTERS } from "./logoLayout";
import {
  createStartupTimeline,
  playStartupExit,
} from "./createStartupTimeline";
import "./StartupAnimation.css";

export type StartupAnimationProps = {
  /** When true, the overlay is shown and the intro plays (or holds on the finished logo). */
  visible: boolean;
  /** Fires once the intro timeline reaches its hold label (before exit). */
  onComplete?: () => void;
  /** Optional app shell element to crossfade in during exit. */
  appShell?: HTMLElement | null;
  /** Fires after the exit fade finishes — safe to unmount. */
  onExitComplete?: () => void;
};

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function waitForLogoFont() {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return;
  }
  try {
    await Promise.race([
      document.fonts.load('800 112px "Outfit"'),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 280);
      }),
    ]);
  } catch {
    // CSS fallback stack remains.
  }
}

function queryTimelineElements(overlay: HTMLElement) {
  const word = overlay.querySelector<SVGGElement>('[data-startup="word"]');
  const leadLetter = overlay.querySelector<SVGGElement>('[data-startup="letter-j"]');
  const bloom = overlay.querySelector<SVGGElement>('[data-startup="bloom"]');
  const shineBand = overlay.querySelector<SVGRectElement>('[data-startup="shine"]');
  const trailingLetters = TRAILING_LETTERS.map((letter) =>
    overlay.querySelector<SVGGElement>(`[data-startup="letter-${letter}"]`),
  ).filter((node): node is SVGGElement => node !== null);

  if (!word || !leadLetter || !bloom || !shineBand || trailingLetters.length !== TRAILING_LETTERS.length) {
    return null;
  }

  return {
    overlay,
    word: word as unknown as HTMLElement,
    leadLetter: leadLetter as unknown as HTMLElement,
    trailingLetters: trailingLetters as unknown as HTMLElement[],
    bloom: bloom as unknown as HTMLElement,
    shineBand: shineBand as unknown as HTMLElement,
  };
}

/**
 * Fullscreen cinematic Jedflix startup overlay.
 *
 * Blocks interaction while active, plays a single GSAP master timeline,
 * holds on the finished wordmark until `visible` becomes false, then
 * crossfades out and tears down cleanly.
 */
export function StartupAnimation({
  visible,
  onComplete,
  appShell,
  onExitComplete,
}: StartupAnimationProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const introTlRef = useRef<gsap.core.Timeline | null>(null);
  const exitTlRef = useRef<gsap.core.Timeline | null>(null);
  const introCompleteRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onExitCompleteRef = useRef(onExitComplete);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  const handleIntroComplete = useCallback(() => {
    if (introCompleteRef.current) {
      return;
    }
    introCompleteRef.current = true;
    onCompleteRef.current?.();
  }, []);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    let cancelled = false;
    const ctx = gsap.context(() => {
      gsap.set(overlay, { autoAlpha: 1 });
    }, overlay);

    void (async () => {
      await waitForLogoFont();
      if (cancelled || !overlayRef.current) {
        return;
      }

      const elements = queryTimelineElements(overlayRef.current);
      if (!elements) {
        handleIntroComplete();
        return;
      }

      const tl = createStartupTimeline(elements, {
        reducedMotion: reducedMotionRef.current,
        onIntroComplete: handleIntroComplete,
      });
      introTlRef.current = tl;
      tl.play(0);
    })();

    return () => {
      cancelled = true;
      introTlRef.current?.kill();
      introTlRef.current = null;
      exitTlRef.current?.kill();
      exitTlRef.current = null;
      ctx.revert();
    };
  }, [handleIntroComplete]);

  useEffect(() => {
    if (visible) {
      return;
    }

    const overlay = overlayRef.current;
    if (!overlay) {
      setMounted(false);
      onExitCompleteRef.current?.();
      return;
    }

    const startExit = () => {
      if (exitTlRef.current) {
        return;
      }
      // Ensure intro-complete has been reported before exit.
      handleIntroComplete();
      exitTlRef.current = playStartupExit({
        overlay,
        appShell,
        reducedMotion: reducedMotionRef.current,
        onComplete: () => {
          setMounted(false);
          onExitCompleteRef.current?.();
        },
      });
    };

    const intro = introTlRef.current;
    if (!intro || introCompleteRef.current || intro.progress() >= 1) {
      startExit();
      return;
    }

    // Never cut the animation short — finish intro, then exit.
    intro.eventCallback("onComplete", () => {
      startExit();
    });
  }, [visible, appShell, handleIntroComplete]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="startup-overlay"
      data-reduced={reducedMotionRef.current ? "true" : "false"}
      role="presentation"
      aria-hidden="true"
    >
      <div className="startup-stage">
        <JedflixLogoSvg className="startup-logo" />
      </div>
    </div>
  );
}
