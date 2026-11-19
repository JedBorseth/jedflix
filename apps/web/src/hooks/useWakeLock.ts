import { useEffect, useRef } from "react";

type WakeLockSentinel = {
  readonly released?: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

export function useWakeLock(enabled = true) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || typeof document === "undefined") {
      return;
    }

    let cancelled = false;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;

    if (!wakeLock) {
      return;
    }

    let pending = false;
    let releaseOwnedSentinel: (() => void) | undefined;

    const requestWakeLock = async () => {
      if (cancelled || pending || document.visibilityState !== "visible" || sentinelRef.current) {
        return;
      }

      pending = true;
      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled || document.visibilityState !== "visible" || sentinelRef.current) {
          await sentinel.release();
          return;
        }
        if (sentinel.released) {
          return;
        }
        const clearSentinel = () => {
          sentinel.removeEventListener("release", clearSentinel);
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
        };
        sentinel.addEventListener("release", clearSentinel);
        sentinelRef.current = sentinel;
        releaseOwnedSentinel = () => {
          if (sentinelRef.current === sentinel) {
            clearSentinel();
            void sentinel.release().catch(() => {});
          }
        };
      } catch {
        // Wake Lock can be denied or unsupported depending on browser/PWA context.
      } finally {
        pending = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      releaseOwnedSentinel?.();
    };
  }, [enabled]);
}
