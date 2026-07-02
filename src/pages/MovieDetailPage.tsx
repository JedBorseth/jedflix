import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/types";

export function MovieDetailPage() {
  const { movieId } = useParams<{ movieId: string }>();
  const movie = useQuery(
    api.movies.getById,
    movieId ? { movieId: movieId as Id<"movies"> } : "skip",
  );

  if (movie === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <div className="flex h-[60vh] items-center justify-center">
          <p className="text-zinc-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (movie === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">Movie not found.</p>
          <Button asChild variant="outline">
            <Link to="/">Back to browse</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <section className="relative min-h-[60vh]">
        <img
          src={movie.backdropUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-black/40" />

        <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-28 md:flex-row md:px-12">
          <img
            src={movie.posterUrl}
            alt={movie.title}
            className="mx-auto w-56 shrink-0 rounded-md shadow-2xl md:mx-0 md:w-64"
          />
          <div className="flex flex-col justify-end">
            <h1 className="mb-4 text-4xl font-bold md:text-5xl">{movie.title}</h1>
            <div className="mb-4 flex flex-wrap gap-3 text-sm text-zinc-300">
              <span>{movie.year}</span>
              <span>{movie.rating}</span>
              <span>{formatDuration(movie.durationMinutes)}</span>
              <span>{movie.genre}</span>
            </div>
            <p className="mb-8 max-w-2xl text-zinc-200">{movie.description}</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-white text-black hover:bg-zinc-200">
                <Link to={`/watch/${movie._id}`}>Play</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-zinc-600">
                <Link to="/">Back to browse</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
