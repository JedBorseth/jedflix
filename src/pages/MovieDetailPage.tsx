import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import type { MediaItem, MediaType } from "@/lib/types";
import { formatDuration } from "@/lib/types";
import { getMediaDetails } from "@/lib/tmdb";
import {
  applyDetailPosterTransition,
  beginDetailPosterTransitionTarget,
  getMediaNavigationState,
  shouldApplyDetailPosterTransitionName,
} from "@/lib/posterTransition";
import { SimilarTitlesRow } from "@/components/browse/SimilarTitlesRow";
import { AddToMyListButton } from "@/components/mylist/AddToMyListButton";
import { MediaReviews } from "@/components/reviews/MediaReviews";

type MovieDetailPageProps = {
  mediaType: MediaType;
};

export function MovieDetailPage({ mediaType }: MovieDetailPageProps) {
  const { mediaId } = useParams<{ mediaId: string }>();
  const location = useLocation();
  const parsedMediaId = Number(mediaId);
  const previewState =
    Number.isFinite(parsedMediaId)
      ? getMediaNavigationState(location.state, mediaType, parsedMediaId)
      : null;
  const preview = previewState?.preview;

  const posterRef = useRef<HTMLImageElement>(null);
  const hasRegisteredTransitionTarget = useRef(false);
  const [movie, setMovie] = useState<MediaItem | null>();
  const [error, setError] = useState<string | null>(null);
  const routeMovie =
    movie && movie.id === parsedMediaId && movie.mediaType === mediaType
      ? movie
      : undefined;
  const displayMovie = routeMovie ?? preview ?? null;

  useLayoutEffect(() => {
    if (!hasRegisteredTransitionTarget.current) {
      beginDetailPosterTransitionTarget();
      hasRegisteredTransitionTarget.current = true;
    }
  }, []);

  useLayoutEffect(() => {
    applyDetailPosterTransition(
      posterRef.current,
      shouldApplyDetailPosterTransitionName(
        Boolean(preview),
        movie,
        mediaType,
        parsedMediaId,
      ),
      mediaType,
      parsedMediaId,
    );
  }, [preview, movie, mediaType, parsedMediaId, displayMovie?.posterUrl]);

  useEffect(() => {
    if (!Number.isFinite(parsedMediaId)) {
      setMovie(null);
      return;
    }

    let cancelled = false;
    setMovie(undefined);
    setError(null);

    getMediaDetails(mediaType, parsedMediaId)
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
  }, [mediaType, parsedMediaId]);

  if (movie === undefined && !preview) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <div className="flex h-[60vh] items-center justify-center">
          <p className="text-zinc-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (displayMovie === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Title not found."}</p>
          <Button asChild variant="outline">
            <Link to="/" viewTransition>
              Back to browse
            </Link>
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
          src={displayMovie.backdropUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-black/40" />

        <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-28 md:flex-row md:px-12">
          <img
            ref={posterRef}
            src={displayMovie.posterUrl}
            alt={displayMovie.title}
            className="mx-auto w-56 shrink-0 rounded-md shadow-2xl md:mx-0 md:w-64"
          />
          <div className="flex flex-col justify-end">
            <h1 className="mb-4 text-4xl font-bold md:text-5xl">{displayMovie.title}</h1>
            <div className="mb-4 flex flex-wrap gap-3 text-sm text-zinc-300">
              {displayMovie.year ? <span>{displayMovie.year}</span> : null}
              <span>{displayMovie.rating}</span>
              {displayMovie.durationMinutes ? (
                <span>{formatDuration(displayMovie.durationMinutes)}</span>
              ) : null}
              {displayMovie.genre ? <span>{displayMovie.genre}</span> : null}
            </div>
            <p className="mb-8 max-w-2xl text-zinc-200">
              {routeMovie?.description ?? displayMovie.description}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-white text-black hover:bg-zinc-200">
                <Link to={`/watch/${displayMovie.mediaType}/${displayMovie.id}`}>Play</Link>
              </Button>
              <AddToMyListButton
                movieId={displayMovie.id}
                mediaType={displayMovie.mediaType}
              />
              <Button asChild size="lg" variant="outline" className="border-zinc-600">
                <Link to="/" viewTransition>
                  Back to browse
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <SimilarTitlesRow
        key={`${displayMovie.mediaType}-${displayMovie.id}`}
        mediaType={displayMovie.mediaType}
        mediaId={displayMovie.id}
      />

      <MediaReviews movieId={displayMovie.id} mediaType={displayMovie.mediaType} />
    </div>
  );
}
