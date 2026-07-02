import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MockVideoPlayer } from "@/components/player/MockVideoPlayer";
import { Button } from "@/components/ui/button";

export function WatchPage() {
  const { movieId } = useParams<{ movieId: string }>();
  const movie = useQuery(
    api.movies.getById,
    movieId ? { movieId: movieId as Id<"movies"> } : "skip",
  );

  if (movie === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        Loading player...
      </div>
    );
  }

  if (movie === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p>Movie not found.</p>
        <Button asChild variant="outline">
          <Link to="/">Back to browse</Link>
        </Button>
      </div>
    );
  }

  return (
    <MockVideoPlayer
      movieId={movie._id}
      title={movie.title}
      durationMinutes={movie.durationMinutes}
    />
  );
}
