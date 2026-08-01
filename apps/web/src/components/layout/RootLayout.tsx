import { Outlet, useLocation } from "react-router-dom";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { ScreenKeepAwake } from "@/components/ScreenKeepAwake";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ScrollToTopOnNavigate } from "@/components/layout/ScrollToTopOnNavigate";

const HIDE_BOTTOM_NAV_PATHS = ["/sign-in", "/onboarding"];

function shouldShowBottomNav(pathname: string) {
  if (HIDE_BOTTOM_NAV_PATHS.includes(pathname)) {
    return false;
  }

  return (
    !pathname.startsWith("/watch") &&
    !pathname.startsWith("/listen") &&
    !pathname.startsWith("/read")
  );
}

export function RootLayout() {
  const { pathname } = useLocation();
  const showBottomNav = shouldShowBottomNav(pathname);

  return (
    <OnboardingGate>
      <ScreenKeepAwake />
      <ScrollToTopOnNavigate />
      <Outlet />
      {showBottomNav ? <MobileBottomNav /> : null}
    </OnboardingGate>
  );
}
