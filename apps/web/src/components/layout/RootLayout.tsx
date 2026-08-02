import { Outlet, useLocation } from "react-router-dom";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { ScreenKeepAwake } from "@/components/ScreenKeepAwake";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ScrollToTopOnNavigate } from "@/components/layout/ScrollToTopOnNavigate";
import { MusicPlayerBar } from "@/components/player/music/MusicPlayerBar";
import { MusicPlayerProvider } from "@/components/player/music/MusicPlayerContext";

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

function shouldShowMusicChrome(pathname: string) {
  return shouldShowBottomNav(pathname);
}

export function RootLayout() {
  const { pathname } = useLocation();
  const showBottomNav = shouldShowBottomNav(pathname);
  const showMusicChrome = shouldShowMusicChrome(pathname);

  return (
    <OnboardingGate>
      <MusicPlayerProvider>
        <ScreenKeepAwake />
        <ScrollToTopOnNavigate />
        <Outlet />
        {showMusicChrome ? <MusicPlayerBar /> : null}
        {showBottomNav ? <MobileBottomNav /> : null}
      </MusicPlayerProvider>
    </OnboardingGate>
  );
}
