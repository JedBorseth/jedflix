import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RootLayout } from "@/components/layout/RootLayout";
import { StartupGate } from "@/components/startup/StartupGate";
import { AudiobookDetailPage } from "@/pages/AudiobookDetailPage";
import { AudiobooksPage } from "@/pages/AudiobooksPage";
import { AlbumDetailPage } from "@/pages/AlbumDetailPage";
import { AuthorPage } from "@/pages/AuthorPage";
import { BrowsePage } from "@/pages/BrowsePage";
import { ComingSoonPage } from "@/pages/ComingSoonPage";
import { MovieDetailPage } from "@/pages/MovieDetailPage";
import { MusicArtistPage } from "@/pages/MusicArtistPage";
import { MusicPage } from "@/pages/MusicPage";
import { MyListPage } from "@/pages/MyListPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { SignInForm } from "@/components/auth/SignInForm";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { PersonPage } from "@/pages/PersonPage";

const WatchPage = lazy(() =>
  import("@/pages/WatchPage").then((module) => ({ default: module.WatchPage })),
);
const ListenPage = lazy(() =>
  import("@/pages/ListenPage").then((module) => ({ default: module.ListenPage })),
);
const ReadPage = lazy(() =>
  import("@/pages/ReadPage").then((module) => ({ default: module.ReadPage })),
);

function WatchPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
      Loading player...
    </div>
  );
}

function LazyWatchPage() {
  return (
    <Suspense fallback={<WatchPageFallback />}>
      <WatchPage />
    </Suspense>
  );
}

function LazyListenPage() {
  return (
    <Suspense fallback={<WatchPageFallback />}>
      <ListenPage />
    </Suspense>
  );
}

function LazyReadPage() {
  return (
    <Suspense fallback={<WatchPageFallback />}>
      <ReadPage />
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/onboarding", element: <OnboardingPage /> },
      { path: "/", element: <BrowsePage /> },
      { path: "/movies", element: <BrowsePage mediaType="movie" /> },
      { path: "/shows", element: <BrowsePage mediaType="tv" /> },
      { path: "/audiobooks", element: <AudiobooksPage /> },
      { path: "/music", element: <MusicPage /> },
      {
        path: "/video-games",
        element: (
          <ComingSoonPage
            title="Video Games"
            description="Video game browsing will live here once catalog support is added."
          />
        ),
      },
      { path: "/movie/:mediaId", element: <MovieDetailPage mediaType="movie" /> },
      { path: "/show/:mediaId", element: <MovieDetailPage mediaType="tv" /> },
      { path: "/audiobook/:workId", element: <AudiobookDetailPage /> },
      { path: "/author/:authorId", element: <AuthorPage /> },
      { path: "/album/:albumId", element: <AlbumDetailPage /> },
      { path: "/music-artist/:artistId", element: <MusicArtistPage /> },
      { path: "/watch/movie/:mediaId", element: <LazyWatchPage /> },
      { path: "/watch/tv/:mediaId/:season/:episode", element: <LazyWatchPage /> },
      { path: "/watch/:mediaType/:mediaId", element: <LazyWatchPage /> },
      { path: "/listen/:workId", element: <LazyListenPage /> },
      { path: "/read/:workId", element: <LazyReadPage /> },
      { path: "/search", element: <SearchPage /> },
      { path: "/person/:personId", element: <PersonPage /> },
      { path: "/my-list", element: <MyListPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/sign-in", element: <SignInForm /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <StartupGate>
      <RouterProvider router={router} />
    </StartupGate>
  );
}
