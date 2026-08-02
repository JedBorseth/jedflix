import type { TvSeasonSummary } from "@/lib/tmdb";

export type NextEpisodeTarget = {
  season: number;
  episode: number;
  label: string;
};

/** Last minute of playback when the next-episode CTA should appear. */
export const NEXT_EPISODE_WINDOW_MS = 60_000;

function labelForNextEpisode(
  seasons: TvSeasonSummary[],
  season: number,
  episode: number,
): string {
  const seasonInfo = seasons.find((entry) => entry.seasonNumber === season);
  if (!seasonInfo || episode < seasonInfo.episodeCount) {
    return "Next Episode";
  }

  const lastSeason = seasons[seasons.length - 1];
  if (lastSeason && season === lastSeason.seasonNumber) {
    return "Final Episode";
  }

  return `Season ${season} Finale`;
}

/**
 * Resolves the next watchable episode after the current one.
 * Labels describe the destination: season finale or series finale when applicable.
 */
export function resolveNextEpisode(
  seasons: TvSeasonSummary[],
  season: number,
  episode: number,
): NextEpisodeTarget | null {
  if (!Number.isFinite(season) || !Number.isFinite(episode) || seasons.length === 0) {
    return null;
  }

  const sorted = [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
  const seasonIndex = sorted.findIndex((entry) => entry.seasonNumber === season);
  if (seasonIndex < 0) {
    return null;
  }

  const currentSeason = sorted[seasonIndex];
  if (!currentSeason || currentSeason.episodeCount < 1) {
    return null;
  }

  if (episode < currentSeason.episodeCount) {
    const nextEpisode = episode + 1;
    return {
      season,
      episode: nextEpisode,
      label: labelForNextEpisode(sorted, season, nextEpisode),
    };
  }

  const nextSeason = sorted[seasonIndex + 1];
  if (!nextSeason || nextSeason.episodeCount < 1) {
    return null;
  }

  return {
    season: nextSeason.seasonNumber,
    episode: 1,
    label: labelForNextEpisode(sorted, nextSeason.seasonNumber, 1),
  };
}

export function isInNextEpisodeWindow(timeMs: number, durationMs: number): boolean {
  if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return false;
  }
  const remaining = durationMs - timeMs;
  return remaining >= 0 && remaining <= NEXT_EPISODE_WINDOW_MS;
}
