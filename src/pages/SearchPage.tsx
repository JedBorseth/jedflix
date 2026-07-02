import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MovieCard } from "@/components/browse/MovieCard";
import { Navbar } from "@/components/layout/Navbar";
import { PosterGridSkeleton } from "@/components/ui/skeleton";
import type { MediaItem } from "@/lib/types";
import { searchMedia } from "@/lib/tmdb";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const [results, setResults] = useState<MediaItem[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setResults(undefined);
    setError(null);

    searchMedia(query)
      .then((items) => {
        if (!cancelled) {
          setResults(items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to search titles");
          setResults([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-28 md:px-12 md:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-2 text-3xl font-bold">Search</h1>
          <p className="mb-8 text-zinc-400">
            {query ? `Results for "${query}"` : "Search for a movie or show."}
          </p>

          {error ? <p className="text-zinc-400">{error}</p> : null}
          {results === undefined ? <PosterGridSkeleton count={8} /> : null}
          {results?.length === 0 && query ? (
            <p className="text-zinc-400">No titles found.</p>
          ) : null}
          {results && results.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-4">
              {results.map((movie) => (
                <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
