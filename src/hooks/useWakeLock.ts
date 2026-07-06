import { useEffect, useRef } from "react";

type WakeLockSentinel = {
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

    const clearSentinel = () => {
      sentinelRef.current = null;
    };

    const requestWakeLock = async () => {
      if (cancelled || document.visibilityState !== "visible" || sentinelRef.current) {
        return;
      }

      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        sentinel.addEventListener("release", clearSentinel);
        sentinelRef.current = sentinel;
      } catch {
        // Wake Lock can be denied or unsupported depending on browser/PWA context.
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

      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) {
        sentinel.removeEventListener("release", clearSentinel);
        void sentinel.release().catch(() => {});
      }
    };
  }, [enabled]);
}
