import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useUserSettings } from "@/hooks/useUserSettings";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { onboardingCompleted } = useUserSettings();
  const { pathname } = useLocation();
  const onOnboarding = pathname === "/onboarding";

  if (!onboardingCompleted && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  if (onboardingCompleted && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return children;
}
