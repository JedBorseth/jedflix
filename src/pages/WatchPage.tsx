import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MockVideoPlayer } from "@/components/player/MockVideoPlayer";
import { Button } from "@/components/ui/button";
import type { MediaItem, MediaType } from "@/lib/types";
import { getMediaDetails } from "@/lib/tmdb";

export function WatchPage() {
  const { mediaType, mediaId } = useParams<{ mediaType: MediaType; mediaId: string }>();
  const [movie, setMovie] = useState<MediaItem | null>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(mediaId);
    if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isFinite(id)) {
      setMovie(null);
      return;
    }

    let cancelled = false;
    setMovie(undefined);
    setError(null);

    getMediaDetails(mediaType, id)
      .then((item) => {
        if (!cancelled) {
          setMovie(item);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load title");
          setMovie(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mediaId, mediaType]);

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
        <p>{error ?? "Title not found."}</p>
        <Button asChild variant="outline">
          <Link to="/">Back to browse</Link>
        </Button>
      </div>
    );
  }

  return (
    <MockVideoPlayer
      movieId={movie.id}
      mediaType={movie.mediaType}
      title={movie.title}
      durationMinutes={movie.durationMinutes ?? 90}
    />
  );
}
