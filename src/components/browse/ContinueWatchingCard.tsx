import { Link } from "react-router-dom";
import type { WatchHistoryItem } from "@/lib/watchHistory";
import { mediaKey } from "@/lib/watchHistory";

type ContinueWatchingCardProps = {
  item: WatchHistoryItem;
};

export function ContinueWatchingCard({ item }: ContinueWatchingCardProps) {
  const totalSeconds = (item.media.durationMinutes ?? 90) * 60;
  const progressPercent = Math.min((item.progressSeconds / totalSeconds) * 100, 100);

  return (
    <Link
      to={`/watch/${item.media.mediaType}/${item.media.id}`}
      viewTransition
      state={{ preview: item.media }}
      className="group relative block w-36 shrink-0 snap-start md:w-44"
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
    </Link>
  );
}

export function getWatchHistoryItemKey(item: WatchHistoryItem) {
  return mediaKey(item.mediaType, item.movieId);
}
