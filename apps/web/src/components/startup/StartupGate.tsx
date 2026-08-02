import { useCallback, useLayoutEffect, useState, type ReactNode } from "react";
import gsap from "gsap";
import { StartupAnimation } from "./StartupAnimation";
import { useAppReady } from "./useAppReady";
import "./StartupAnimation.css";

type StartupGateProps = {
  children: ReactNode;
};

/**
 * Mounts the cinematic startup overlay on cold launch and keeps it up until
 * both the intro timeline has finished and the application reports ready.
 * The app shell renders underneath (hidden) so the exit crossfade feels seamless.
 */
export function StartupGate({ children }: StartupGateProps) {
  const appReady = useAppReady();
  const [introComplete, setIntroComplete] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(true);
  const [appShell, setAppShell] = useState<HTMLElement | null>(null);

  const dismissible = introComplete && appReady;
  const showOverlay = overlayMounted && !dismissible;

  const setAppShellRef = useCallback((node: HTMLDivElement | null) => {
    setAppShell(node);
  }, []);

  useLayoutEffect(() => {
    if (!appShell || !overlayMounted) {
      return;
    }
    // Opacity only — never set transform on the shell (breaks position:fixed nav).
    gsap.set(appShell, { opacity: 0, visibility: "hidden", clearProps: "transform" });
  }, [appShell, overlayMounted]);

  const handleIntroComplete = useCallback(() => {
    setIntroComplete(true);
  }, []);

  const handleExitComplete = useCallback(() => {
    setOverlayMounted(false);
    if (appShell) {
      gsap.set(appShell, {
        clearProps: "transform,opacity,visibility,will-change",
      });
      appShell.style.transform = "";
      appShell.style.willChange = "";
      appShell.style.opacity = "";
      appShell.style.visibility = "";
      appShell.dataset.startupPending = "false";
    }
  }, [appShell]);

  return (
    <>
      <div
        ref={setAppShellRef}
        className="startup-app-shell"
        data-startup-pending={overlayMounted ? "true" : "false"}
      >
        {children}
      </div>

      {overlayMounted ? (
        <StartupAnimation
          visible={showOverlay}
          onComplete={handleIntroComplete}
          appShell={appShell}
          onExitComplete={handleExitComplete}
        />
      ) : null}
    </>
  );
}
