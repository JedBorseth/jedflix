import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { HeroBanner } from "@/components/browse/HeroBanner";
import { MovieRow } from "@/components/browse/MovieRow";
import { Navbar } from "@/components/layout/Navbar";

export function BrowsePage() {
  const genres = useQuery(api.movies.listGenres);
  const featured = useQuery(api.movies.listFeatured);
  const allMovies = useQuery(api.movies.listAll);

  const heroMovie = featured?.[0] ?? allMovies?.[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      {heroMovie ? (
        <HeroBanner movie={heroMovie} />
      ) : (
        <div className="flex h-[50vh] items-center justify-center pt-20">
          <p className="text-zinc-400">Loading featured title...</p>
        </div>
      )}

      <div className="-mt-16 relative z-10 pb-16">
        {genres === undefined ? (
          <div className="px-4 md:px-12">
            <div className="h-8 w-40 animate-pulse rounded bg-zinc-800" />
          </div>
        ) : genres.length === 0 ? (
          <div className="px-4 py-12 text-center text-zinc-400 md:px-12">
            <p>No movies yet. Run `bunx convex run seed:seedMovies` to add demo titles.</p>
          </div>
        ) : (
          genres.map((genre) => <MovieRow key={genre} genre={genre} />)
        )}
      </div>
    </div>
  );
}
