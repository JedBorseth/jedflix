import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@convex/_generated/api";
import { Navbar } from "@/components/layout/Navbar";
import { MovieCard } from "@/components/browse/MovieCard";
import { BookCard } from "@/components/browse/BookCard";
import { PosterGridSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Authenticated, Unauthenticated } from "convex/react";
import { isBookMediaType, isVideoMediaType } from "@jedflix/shared";
import { getWorkDetails } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { getMediaDetailsByIds } from "@/lib/tmdb";

export function MyListPage() {
  const savedList = useConvexQuery(api.myList.getForUser);

  const videoIds = useMemo(
    () =>
      (savedList ?? [])
        .filter(
          (entry) =>
            isVideoMediaType(entry.mediaType) && typeof entry.movieId === "number",
        )
        .map((entry) => ({
          mediaType: entry.mediaType as "movie" | "tv",
          movieId: entry.movieId as number,
        })),
    [savedList],
  );

  const bookIds = useMemo(
    () =>
      (savedList ?? [])
        .filter((entry) => isBookMediaType(entry.mediaType) && entry.workId)
        .map((entry) => entry.workId as string),
    [savedList],
  );

  const moviesQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.detailsByIds(videoIds),
    queryFn: () => getMediaDetailsByIds(videoIds),
    enabled: savedList !== undefined && videoIds.length > 0,
  });

  const booksQuery = useQuery({
    queryKey: ["my-list-books", bookIds],
    queryFn: async () => Promise.all(bookIds.map((id) => getWorkDetails(id))),
    enabled: savedList !== undefined && bookIds.length > 0,
  });

  const movies =
    savedList !== undefined && videoIds.length === 0 ? [] : moviesQuery.data;
  const books =
    savedList !== undefined && bookIds.length === 0 ? [] : booksQuery.data;

  const error =
    moviesQuery.error || booksQuery.error
      ? ((moviesQuery.error ?? booksQuery.error) instanceof Error
          ? (moviesQuery.error ?? booksQuery.error)!.message
          : "Unable to load your titles")
      : null;

  const loadingMedia =
    (videoIds.length > 0 && movies === undefined) ||
    (bookIds.length > 0 && books === undefined);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="pt-navbar mx-auto max-w-6xl px-4 pb-24 md:px-12 md:pb-16">
        <h1 className="mb-8 text-3xl font-bold">My List</h1>

        <Unauthenticated>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="mb-4 text-zinc-300">Sign in to save titles to My List.</p>
            <Button asChild className="bg-red-600 hover:bg-red-700">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </div>
        </Unauthenticated>

        <Authenticated>
          {savedList === undefined ? (
            <PosterGridSkeleton count={6} />
          ) : savedList.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
              <p className="mb-4 text-zinc-300">
                Your list is empty. Add titles from any movie, show, or book page.
              </p>
              <Button asChild variant="outline" className="border-zinc-600">
                <Link to="/">Browse titles</Link>
              </Button>
            </div>
          ) : error ? (
            <p className="text-zinc-400">{error}</p>
          ) : loadingMedia ? (
            <PosterGridSkeleton count={savedList.length || 6} />
          ) : (
            <div className="flex flex-wrap gap-4">
              {(movies ?? []).map((movie) => (
                <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
              ))}
              {(books ?? []).map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          )}
        </Authenticated>
      </main>
    </div>
  );
}
