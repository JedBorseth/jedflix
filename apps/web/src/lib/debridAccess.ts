import { toast } from "sonner";
import { getUserSettings, hasRealDebridApiKey } from "@/lib/userSettings";

export const DEBRID_REQUIRED_TOAST =
  "Add a Real Debrid API key in Settings to watch movies and shows.";

/** Returns true when navigation should be blocked (no Real Debrid key). */
export function blockDebridMediaNavigation(): boolean {
  if (hasRealDebridApiKey(getUserSettings())) {
    return false;
  }
  toast.error(DEBRID_REQUIRED_TOAST);
  return true;
}
