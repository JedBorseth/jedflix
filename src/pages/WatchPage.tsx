import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { StremioPlayer } from "@/components/player/stremio/StremioPlayer";
import { Button } from "@/components/ui/button";
import type { MediaItem, MediaType } from "@/lib/types";
import { getExternalIds, getMediaDetails, getMediaDetailPath } from "@/lib/tmdb";
import { getStreamMode } from "@/lib/streamMode";

function parseWatchParams(params: {
  mediaType?: string;
  mediaId?: string;
  season?: string;
  episode?: string;
}): {
  mediaType: MediaType | null;
  mediaId: number;
  season?: number;
  episode?: number;
} {
  const pathname = window.location.pathname;
  if (pathname.startsWith("/watch/movie/")) {
    return {
      mediaType: "movie",
      mediaId: Number(params.mediaId),
    };
  }
  if (pathname.startsWith("/watch/tv/")) {
    return {
      mediaType: "tv",
      mediaId: Number(params.mediaId),
      season: Number(params.season),
      episode: Number(params.episode),
    };
  }
  return {
    mediaType:
      params.mediaType === "movie" || params.mediaType === "tv" ? params.mediaType : null,
    mediaId: Number(params.mediaId),
    season: params.season ? Number(params.season) : undefined,
    episode: params.episode ? Number(params.episode) : undefined,
  };
}

export function WatchPage() {
  const params = useParams<{
    mediaType?: string;
    mediaId?: string;
    season?: string;
    episode?: string;
  }>();
  const { mediaType, mediaId, season, episode } = parseWatchParams(params);
  const [movie, setMovie] = useState<MediaItem | null>();
  const [imdbId, setImdbId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mode = getStreamMode();

  const history = useQuery(api.watchHistory.getForUser);
  const savedProgress = useMemo(() => {
    if (!history) {
      return 0;
    }
    const entry = history.find(
      (item) =>
        item.mediaType === mediaType &&
        item.movieId === mediaId &&
        (mediaType !== "tv" || (item.season === season && item.episode === episode)),
    );
    return entry?.progressSeconds ?? 0;
  }, [episode, history, mediaId, mediaType, season]);

  useEffect(() => {
    if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isFinite(mediaId)) {
      setMovie(null);
      return;
    }
    if (mediaType === "tv" && (!Number.isFinite(season) || !Number.isFinite(episode))) {
      setMovie(null);
      setError("Season and episode are required for TV playback.");
      return;
    }

    let cancelled = false;
    setMovie(undefined);
    setError(null);
    setImdbId(null);

    Promise.all([getMediaDetails(mediaType, mediaId), getExternalIds(mediaType, mediaId)])
      .then(([item, externalIds]) => {
        if (!cancelled) {
          if (!item) {
            setMovie(null);
            return;
          }
          if (!externalIds.imdbId) {
            setError("This title does not have an IMDb ID required for streaming.");
            setMovie(null);
            return;
          }
          setMovie({ ...item, imdbId: externalIds.imdbId });
          setImdbId(externalIds.imdbId);
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
  }, [episode, mediaId, mediaType, season]);

  if (movie === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        Loading player...
      </div>
    );
  }

  if (movie === null || !imdbId) {
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
    <StremioPlayer
      movieId={movie.id}
      mediaType={movie.mediaType}
      title={movie.title}
      imdbId={imdbId}
      season={season}
      episode={episode}
      mode={mode}
      initialProgressSeconds={savedProgress}
      backPath={getMediaDetailPath(movie)}
    />
  );
}
