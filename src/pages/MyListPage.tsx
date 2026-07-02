import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Navbar } from "@/components/layout/Navbar";
import { MovieCard } from "@/components/browse/MovieCard";
import { Button } from "@/components/ui/button";
import { Authenticated, Unauthenticated } from "convex/react";
import type { MediaItem } from "@/lib/types";
import { getMediaDetailsByIds } from "@/lib/tmdb";

export function MyListPage() {
  const history = useQuery(api.watchHistory.getForUser);
  const [movies, setMovies] = useState<MediaItem[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!history) {
      setMovies(undefined);
      return;
    }

    let cancelled = false;
    setMovies(undefined);
    setError(null);

    getMediaDetailsByIds(history)
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
  }, [history]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-28 md:px-12">
        <h1 className="mb-8 text-3xl font-bold">My List</h1>

        <Unauthenticated>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="mb-4 text-zinc-300">Sign in to see your watch history.</p>
            <Button asChild className="bg-red-600 hover:bg-red-700">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </div>
        </Unauthenticated>

        <Authenticated>
          {history === undefined ? (
            <p className="text-zinc-400">Loading your list...</p>
          ) : history.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
              <p className="mb-4 text-zinc-300">
                Nothing here yet. Start watching to build your list.
              </p>
              <Button asChild variant="outline" className="border-zinc-600">
                <Link to="/">Browse movies</Link>
              </Button>
            </div>
          ) : error ? (
            <p className="text-zinc-400">{error}</p>
          ) : movies === undefined ? (
            <p className="text-zinc-400">Loading your titles...</p>
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
