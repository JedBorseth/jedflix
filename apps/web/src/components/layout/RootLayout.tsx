import { Outlet, useLocation } from "react-router-dom";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { ScreenKeepAwake } from "@/components/ScreenKeepAwake";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Navbar } from "@/components/layout/Navbar";
import { ScrollToTopOnNavigate } from "@/components/layout/ScrollToTopOnNavigate";
import { PartyPanel } from "@/components/party/PartyPanel";
import { PartyProvider } from "@/components/party/PartyProvider";
import { MusicPlayerBar } from "@/components/player/music/MusicPlayerBar";
import { MusicPlayerProvider } from "@/components/player/music/MusicPlayerContext";

const HIDE_CHROME_PATHS = ["/sign-in", "/onboarding"];

function shouldShowBottomNav(pathname: string) {
  if (HIDE_CHROME_PATHS.includes(pathname)) {
    return false;
  }

  return (
    !pathname.startsWith("/watch") &&
    !pathname.startsWith("/listen") &&
    !pathname.startsWith("/read")
  );
}

function shouldShowNavbar(pathname: string) {
  if (pathname === "/onboarding") {
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
  const showNavbar = shouldShowNavbar(pathname);
  const showMusicChrome = shouldShowMusicChrome(pathname);

  return (
    <MusicPlayerProvider>
      <PartyProvider>
        <OnboardingGate>
          <ScreenKeepAwake />
          <ScrollToTopOnNavigate />
          {showNavbar ? <Navbar /> : null}
          <Outlet />
          {/* Stack player + nav so they sit flush with no gap */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col">
            {showMusicChrome ? <MusicPlayerBar /> : null}
            {showBottomNav ? <MobileBottomNav /> : null}
          </div>
          <PartyPanel />
        </OnboardingGate>
      </PartyProvider>
    </MusicPlayerProvider>
  );
}
