import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { catalogQueryKeys } from "@/lib/queryClient";
import { getTvSeasonEpisodes, getTvSeasons } from "@/lib/tmdb";

type EpisodePickerProps = {
  showId: number;
};

export function EpisodePicker({ showId }: EpisodePickerProps) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  const seasonsQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.seasons(showId),
    queryFn: () => getTvSeasons(showId),
  });

  const seasons = seasonsQuery.data;
  const activeSeason =
    selectedSeason ?? seasons?.[0]?.seasonNumber ?? null;

  const episodesQuery = useQuery({
    queryKey:
      activeSeason === null
        ? catalogQueryKeys.tmdb.episodes(showId, -1)
        : catalogQueryKeys.tmdb.episodes(showId, activeSeason),
    queryFn: () => getTvSeasonEpisodes(showId, activeSeason!),
    enabled: activeSeason !== null,
  });

  const episodes = episodesQuery.data;
  const error = seasonsQuery.error ?? episodesQuery.error;
  const errorMessage =
    error instanceof Error ? error.message : error ? "Unable to load episodes" : null;

  if (seasons === undefined) {
    return <p className="text-sm text-zinc-400">Loading seasons...</p>;
  }

  if (seasons.length === 0) {
    return <p className="text-sm text-zinc-400">{errorMessage ?? "No seasons available."}</p>;
  }

  return (
    <section className="mt-8">
      <h2 className="mb-4 text-xl font-semibold text-white">Episodes</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {seasons.map((season) => (
          <Button
            key={season.seasonNumber}
            type="button"
            size="sm"
            variant={activeSeason === season.seasonNumber ? "default" : "outline"}
            className={
              activeSeason === season.seasonNumber
                ? "bg-red-600 hover:bg-red-700"
                : "border-zinc-600 bg-black/40 text-white"
            }
            onClick={() => setSelectedSeason(season.seasonNumber)}
          >
            {season.name}
          </Button>
        ))}
      </div>

      {episodes === undefined ? (
        <p className="text-sm text-zinc-400">Loading episodes...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {episodes.map((episode) => (
            <Link
              key={episode.episodeNumber}
              to={`/watch/tv/${showId}/${activeSeason}/${episode.episodeNumber}`}
              className="flex gap-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-3 transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              {episode.stillUrl ? (
                <img
                  src={episode.stillUrl}
                  alt=""
                  className="h-20 w-32 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded bg-zinc-800 text-sm text-zinc-400">
                  E{episode.episodeNumber}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  {episode.episodeNumber}. {episode.title}
                </p>
                {episode.overview ? (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{episode.overview}</p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
