import { useEffect, useState } from "react";
import {
  getUserSettings,
  hasRealDebridApiKey,
  subscribeUserSettings,
} from "@/lib/userSettings";

/** Local-only subscription — no Convex required (safe for browse cards). */
export function useHasRealDebridApiKey(): boolean {
  const [hasKey, setHasKey] = useState(() => hasRealDebridApiKey(getUserSettings()));

  useEffect(() => {
    return subscribeUserSettings((settings) => {
      setHasKey(hasRealDebridApiKey(settings));
    });
  }, []);

  return hasKey;
}
