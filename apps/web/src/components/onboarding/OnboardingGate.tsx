import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useParty } from "@/components/party/partyContext";
import { isPartyJoinPath } from "@/lib/partyClient";
import { isTvPairingPath } from "@/lib/tvRdKey";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { onboardingCompleted } = useUserSettings();
  const { pathname, search } = useLocation();
  const { party, isGuest, loading } = useParty();
  const onOnboarding = pathname === "/onboarding";

  if (isTvPairingPath(pathname) || isPartyJoinPath(pathname)) {
    return children;
  }

  if (isGuest && loading) {
    return (
      <div
        role="status"
        className="flex min-h-screen items-center justify-center text-zinc-400"
      >
        Rejoining party…
      </div>
    );
  }

  if (isGuest && party) {
    const musicPath =
      pathname.startsWith("/music") ||
      pathname.startsWith("/album/") ||
      (pathname === "/search" &&
        new URLSearchParams(search).get("type") === "music");
    if (musicPath || pathname === "/sign-in" || onOnboarding) return children;
    return <Navigate to="/music" replace />;
  }
  if (isGuest && !party && !onOnboarding)
    return <Navigate to="/party" replace />;
  if (party) return children;

  if (!onboardingCompleted && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  if (onboardingCompleted && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return children;
}
