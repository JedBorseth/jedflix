import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Navbar } from "@/components/layout/Navbar";
import { MovieCard } from "@/components/browse/MovieCard";
import { PosterGridSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Authenticated, Unauthenticated } from "convex/react";
import type { MediaItem } from "@/lib/types";
import { getMediaDetailsByIds } from "@/lib/tmdb";

export function MyListPage() {
  const savedList = useQuery(api.myList.getForUser);
  const [movies, setMovies] = useState<MediaItem[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!savedList) {
      setMovies(undefined);
      return;
    }

    let cancelled = false;
    setMovies(undefined);
    setError(null);

    getMediaDetailsByIds(savedList)
      .then((items) => {
        if (!cancelled) {
          setMovies(items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load your titles");
          setMovies([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [savedList]);

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
                Your list is empty. Add titles from any movie or show page.
              </p>
              <Button asChild variant="outline" className="border-zinc-600">
                <Link to="/">Browse titles</Link>
              </Button>
            </div>
          ) : error ? (
            <p className="text-zinc-400">{error}</p>
          ) : movies === undefined ? (
            <PosterGridSkeleton count={savedList.length || 6} />
          ) : (
            <div className="flex flex-wrap gap-4">
              {movies.map((movie) => (
                <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
              ))}
            </div>
          )}
        </Authenticated>
      </main>
    </div>
  );
}
