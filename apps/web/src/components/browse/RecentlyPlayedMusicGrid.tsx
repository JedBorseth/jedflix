import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { useMusicPlayer, type MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import type { RecentMusicTrack } from "@/lib/recentlyPlayedMusic";
import { cn } from "@/lib/utils";

type RecentlyPlayedMusicGridProps = {
  tracks: RecentMusicTrack[];
};

export function RecentlyPlayedMusicGrid({ tracks }: RecentlyPlayedMusicGridProps) {
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();

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
    const next = queue[index];
    if (next) {
      musicPlayer.playTrack(next, queue);
    }
  }

  return (
    <section className="px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:mb-4 md:text-2xl">
        Recently Played
      </h2>
      {/* Mobile: 2-col Spotify chips. Desktop: wider grid so the home page fills. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 lg:grid-cols-4 lg:gap-3">
        {tracks.map((track, index) => {
          const isActive = musicPlayer.current?.id === track.id;
          const artist = track.artists.filter(Boolean).join(", ");
          const queueTrack: MusicQueueTrack = {
            id: track.id,
            title: track.title,
            artists: track.artists,
            artistIds: track.artistIds,
            albumName: track.albumName,
            albumId: track.albumId,
            imageUrl: track.imageUrl,
            durationMs: track.durationMs,
          };
          return (
            <SwipeableTrackRow
              key={`${track.id}-${track.playedAt}`}
              className="rounded-md"
              onPlay={() => playRecent(track, index)}
              onAddToQueue={() => musicPlayer.addToQueue(queueTrack)}
              onLike={() => void likeTrack(queueTrack)}
            >
              <div
                className={cn(
                  "flex min-w-0 items-center gap-3 rounded-md bg-zinc-900/80 p-2 text-left transition-colors hover:bg-zinc-800 md:gap-3.5 md:p-2.5",
                  isActive && "ring-1 ring-red-600/70",
                )}
              >
                <ProgressiveCoverImage
                  src={track.imageUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded object-cover md:h-16 md:w-16"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm font-medium md:text-[15px]",
                      isActive ? "text-red-400" : "text-white",
                    )}
                  >
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-zinc-500 md:text-sm">
                    {artist || track.albumName}
                  </p>
                </div>
              </div>
            </SwipeableTrackRow>
          );
        })}
      </div>
    </section>
  );
}
