import { AppLink } from "@/components/layout/AppLink";
import { useHasRealDebridApiKey } from "@/hooks/useHasRealDebridApiKey";
import { blockDebridMediaNavigation } from "@/lib/debridAccess";
import type { WatchHistoryItem } from "@/lib/watchHistory";
import { getWatchPath } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

type ContinueWatchingCardProps = {
  item: WatchHistoryItem;
};

export function ContinueWatchingCard({ item }: ContinueWatchingCardProps) {
  const totalSeconds = (item.media.durationMinutes ?? 90) * 60;
  const progressPercent = Math.min((item.progressSeconds / totalSeconds) * 100, 100);
  const hasDebridKey = useHasRealDebridApiKey();

  return (
    <AppLink
      to={getWatchPath(
        item.mediaType === "tv" ? "tv" : "movie",
        item.media.id,
        item.season,
        item.episode,
      )}
      state={{ preview: item.media }}
      aria-disabled={!hasDebridKey}
      onClick={(event) => {
        if (blockDebridMediaNavigation()) {
          event.preventDefault();
        }
      }}
      className={cn(
        "group relative block w-36 shrink-0 snap-start md:w-44",
        !hasDebridKey && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <img
          src={item.media.posterUrl}
          alt={item.media.title}
          className="aspect-[2/3] w-full object-cover [contain:layout]"
        />
        <div className="h-1 bg-zinc-800">
          <div className="h-full bg-red-600" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
      <p className="mt-2 truncate text-sm text-zinc-300 group-hover:text-white">
        {item.media.title}
      </p>
    </AppLink>
  );
}
