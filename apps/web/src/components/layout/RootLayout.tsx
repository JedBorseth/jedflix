import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { ScreenKeepAwake } from "@/components/ScreenKeepAwake";
import { SpotifyImportProgress } from "@/components/library/SpotifyImportProgress";
import { MediaHomeBackButton } from "@/components/layout/MediaHomeBackButton";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Navbar } from "@/components/layout/Navbar";
import { ScrollToTopOnNavigate } from "@/components/layout/ScrollToTopOnNavigate";
import { PartyPanel } from "@/components/party/PartyPanel";
import { PartyProvider } from "@/components/party/PartyProvider";
import { MusicPlayerBar } from "@/components/player/music/MusicPlayerBar";
import {
  MusicPlayerProvider,
  useMusicPlayer,
} from "@/components/player/music/MusicPlayerContext";
import { cn } from "@/lib/utils";

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

function QueueAwareMain() {
  const { pathname } = useLocation();
  const { queueOpen } = useMusicPlayer();
  const showQueueInset = queueOpen && shouldShowMusicChrome(pathname);

  return (
    <div
      className={cn(
        "relative transition-[padding] duration-200 ease-out",
        showQueueInset && "desktop-queue-open",
      )}
    >
      <MediaHomeBackButton />
      <Outlet />
    </div>
  );
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
          <QueueAwareMain />
          {/* Stack player + nav so they sit flush with no gap */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col">
            {showMusicChrome ? <MusicPlayerBar /> : null}
            {showBottomNav ? <MobileBottomNav /> : null}
          </div>
          <PartyPanel />
          <SpotifyImportProgress />
          <Toaster theme="dark" position="bottom-right" richColors closeButton />
        </OnboardingGate>
      </PartyProvider>
    </MusicPlayerProvider>
  );
}
