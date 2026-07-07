import { useEffect } from "react";

type LockableOrientation = {
  lock?: (orientation: "landscape") => Promise<void>;
  unlock?: () => void;
};

type LockableScreen = Screen & {
  orientation?: LockableOrientation;
};

export function useScreenOrientationLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof screen === "undefined") {
      return;
    }

    const orientation = (screen as LockableScreen).orientation;
    if (!orientation?.lock) {
      return;
    }

    void orientation.lock("landscape").catch(() => {
      // Some browsers only allow orientation lock from installed PWAs or fullscreen contexts.
    });

    return () => {
      orientation.unlock?.();
    };
  }, [enabled]);
}
