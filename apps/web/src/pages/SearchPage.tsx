import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MovieCard } from "@/components/browse/MovieCard";
import { PersonCard } from "@/components/browse/PersonCard";
import { Navbar } from "@/components/layout/Navbar";
import { PosterGridSkeleton } from "@/components/ui/skeleton";
import type { MediaItem, PersonSummary } from "@/lib/types";
import { searchAll } from "@/lib/tmdb";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const [mediaResults, setMediaResults] = useState<MediaItem[]>();
  const [peopleResults, setPeopleResults] = useState<PersonSummary[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setMediaResults([]);
      setPeopleResults([]);
      return;
    }

    let cancelled = false;
    setMediaResults(undefined);
    setPeopleResults(undefined);
    setError(null);

    searchAll(query)
      .then(({ media, people }) => {
        if (!cancelled) {
          setMediaResults(media);
          setPeopleResults(people);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to search");
          setMediaResults([]);
          setPeopleResults([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const isLoading = mediaResults === undefined || peopleResults === undefined;
  const hasResults =
    (mediaResults?.length ?? 0) > 0 || (peopleResults?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="pt-navbar mx-auto max-w-7xl px-4 pb-24 md:px-12 md:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-2 text-3xl font-bold">Search</h1>
          <p className="mb-8 text-zinc-400">
            {query ? `Results for "${query}"` : "Search for a movie, show, or cast member."}
          </p>

          {error ? <p className="text-zinc-400">{error}</p> : null}
          {isLoading ? <PosterGridSkeleton count={8} /> : null}
          {!isLoading && !hasResults && query ? (
            <p className="text-zinc-400">No results found.</p>
          ) : null}

          {!isLoading && peopleResults && peopleResults.length > 0 ? (
            <section className="mb-10 text-left">
              <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">People</h2>
              <div className="flex flex-wrap justify-center gap-4">
                {peopleResults.map((person) => (
                  <PersonCard key={person.id} person={person} />
                ))}
              </div>
            </section>
          ) : null}

          {!isLoading && mediaResults && mediaResults.length > 0 ? (
            <section className="text-left">
              <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">Titles</h2>
              <div className="flex flex-wrap justify-center gap-4">
                {mediaResults.map((movie) => (
                  <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
