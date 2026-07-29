import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RootLayout } from "@/components/layout/RootLayout";
import { AudiobookDetailPage } from "@/pages/AudiobookDetailPage";
import { AudiobooksPage } from "@/pages/AudiobooksPage";
import { AuthorPage } from "@/pages/AuthorPage";
import { BrowsePage } from "@/pages/BrowsePage";
import { ComingSoonPage } from "@/pages/ComingSoonPage";
import { MovieDetailPage } from "@/pages/MovieDetailPage";
import { MyListPage } from "@/pages/MyListPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { SignInForm } from "@/components/auth/SignInForm";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { PersonPage } from "@/pages/PersonPage";

const WatchPage = lazy(() =>
  import("@/pages/WatchPage").then((module) => ({ default: module.WatchPage })),
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

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/onboarding", element: <OnboardingPage /> },
      { path: "/", element: <BrowsePage /> },
      { path: "/movies", element: <BrowsePage mediaType="movie" /> },
      { path: "/shows", element: <BrowsePage mediaType="tv" /> },
      { path: "/audiobooks", element: <AudiobooksPage /> },
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
      { path: "/watch/movie/:mediaId", element: <LazyWatchPage /> },
      { path: "/watch/tv/:mediaId/:season/:episode", element: <LazyWatchPage /> },
      { path: "/watch/:mediaType/:mediaId", element: <LazyWatchPage /> },
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
  return <RouterProvider router={router} />;
}
