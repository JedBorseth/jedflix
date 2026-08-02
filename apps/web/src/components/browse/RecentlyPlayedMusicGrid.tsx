import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { useMusicPlayer, type MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";
import type { RecentMusicTrack } from "@/lib/recentlyPlayedMusic";
import { cn } from "@/lib/utils";

type RecentlyPlayedMusicGridProps = {
  tracks: RecentMusicTrack[];
};

export function RecentlyPlayedMusicGrid({ tracks }: RecentlyPlayedMusicGridProps) {
  const musicPlayer = useMusicPlayer();

  if (tracks.length === 0) {
    return null;
  }

  function playRecent(track: RecentMusicTrack, index: number) {
    const queue: MusicQueueTrack[] = tracks.map((item) => ({
      id: item.id,
      title: item.title,
      artists: item.artists,
      artistIds: item.artistIds,
      albumName: item.albumName,
      albumId: item.albumId,
      imageUrl: item.imageUrl,
      durationMs: item.durationMs,
    }));
    musicPlayer.playTrack(queue[index]!, queue);
  }

  return (
    <section className="px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">Recently Played</h2>
      <div className="grid grid-cols-2 gap-2 md:gap-3">
        {tracks.map((track, index) => {
          const isActive = musicPlayer.current?.id === track.id;
          const artist = track.artists.filter(Boolean).join(", ");
          return (
            <button
              key={`${track.id}-${track.playedAt}`}
              type="button"
              onClick={() => playRecent(track, index)}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-md bg-zinc-900/80 p-2 text-left transition-colors hover:bg-zinc-800",
                isActive && "ring-1 ring-red-600/70",
              )}
            >
              <ProgressiveCoverImage
                src={track.imageUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover md:h-14 md:w-14"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    isActive ? "text-red-400" : "text-white",
                  )}
                >
                  {track.title}
                </p>
                <p className="truncate text-xs text-zinc-500">{artist || track.albumName}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
