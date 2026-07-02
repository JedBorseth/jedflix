import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { BrowsePage } from "@/pages/BrowsePage";
import { MovieDetailPage } from "@/pages/MovieDetailPage";
import { WatchPage } from "@/pages/WatchPage";
import { MyListPage } from "@/pages/MyListPage";
import { SignInForm } from "@/components/auth/SignInForm";
import { SearchPage } from "@/pages/SearchPage";

const router = createBrowserRouter([
  { path: "/", element: <BrowsePage /> },
  { path: "/movies", element: <BrowsePage mediaType="movie" /> },
  { path: "/shows", element: <BrowsePage mediaType="tv" /> },
  { path: "/movie/:mediaId", element: <MovieDetailPage mediaType="movie" /> },
  { path: "/show/:mediaId", element: <MovieDetailPage mediaType="tv" /> },
  { path: "/watch/movie/:mediaId", element: <WatchPage /> },
  { path: "/watch/tv/:mediaId/:season/:episode", element: <WatchPage /> },
  { path: "/watch/:mediaType/:mediaId", element: <WatchPage /> },
  { path: "/search", element: <SearchPage /> },
  { path: "/my-list", element: <MyListPage /> },
  { path: "/sign-in", element: <SignInForm /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
