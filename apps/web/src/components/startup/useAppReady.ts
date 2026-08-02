import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";

const AUTH_READY_TIMEOUT_MS = 4000;

/**
 * Reports when the application shell is ready enough to reveal under the
 * startup overlay. Waits for Convex auth to settle and fonts to resolve
 * (with safety timeouts so a slow network never traps the user on the logo).
 */
export function useAppReady() {
  const { isLoading } = useConvexAuth();
  const [assetsReady, setAssetsReady] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (document.fonts) {
          await Promise.race([
            document.fonts.ready,
            new Promise<void>((resolve) => {
              window.setTimeout(resolve, 1200);
            }),
          ]);
        }
      } catch {
        // Ignore font readiness failures.
      }

      // Two RAFs: allow the first route paint to commit under the overlay.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) {
            setAssetsReady(true);
          }
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setAuthTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setAuthTimedOut(true);
    }, AUTH_READY_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isLoading]);

  return assetsReady && (!isLoading || authTimedOut);
}
