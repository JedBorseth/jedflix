import { useWakeLock } from "@/hooks/useWakeLock";

export function ScreenKeepAwake() {
  useWakeLock();

  return null;
}
