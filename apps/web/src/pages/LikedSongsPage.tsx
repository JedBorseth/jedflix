import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { HeartFilledIcon } from "@radix-ui/react-icons";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Button } from "@/components/ui/button";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import { formatTrackDuration } from "@/lib/spotify";
import { cn } from "@/lib/utils";

export function LikedSongsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-6xl pb-36 md:pb-32">
        <div className="px-4 md:px-12">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-rose-600 to-rose-900 md:h-24 md:w-24">
              <HeartFilledIcon className="h-8 w-8 text-white md:h-10 md:w-10" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Playlist
              </p>
              <h1 className="text-3xl font-bold tracking-tight">Liked Songs</h1>
            </div>
          </div>
        </div>

        <Unauthenticated>
          <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
            <p className="mb-4 text-zinc-300">Sign in to see your liked songs.</p>
            <Button asChild className="bg-red-600 hover:bg-red-700">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </div>
        </Unauthenticated>

        <Authenticated>
          <LikedSongsList />
        </Authenticated>
      </main>
    </div>
  );
}

function LikedSongsList() {
  const liked = useQuery(api.likedSongs.list);
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const activeTrackId = musicPlayer.current?.id;

  if (liked === undefined) {
    return (
      <div className="px-4 md:px-12">
        <p className="text-sm text-zinc-500">Loading liked songs…</p>
      </div>
    );
  }

  if (liked.length === 0) {
    return (
      <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
          <p className="mb-2 text-zinc-300">No liked songs yet.</p>
          <p className="mb-4 text-sm text-zinc-500">
            Swipe left on any song to add it here.
          </p>
        <Button asChild variant="outline" className="border-zinc-600">
          <Link to="/music">Browse music</Link>
        </Button>
      </div>
    );
  }

  const queue: MusicQueueTrack[] = liked.map((track) => ({
    id: track.id,
    title: track.title,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName,
    albumId: track.albumId,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
  }));

  return (
    <section>
      <p className="mb-4 px-4 text-sm text-zinc-400 md:px-12">
        {liked.length} {liked.length === 1 ? "song" : "songs"}
      </p>
      <div className="divide-y divide-zinc-900">
        {liked.map((track, index) => {
          const queueTrack = queue[index];
          if (!queueTrack) {
            return null;
          }
          const isActive = activeTrackId === track.id;
          return (
            <SwipeableTrackRow
              key={track._id}
              onPlay={() => musicPlayer.playTrack(queueTrack, queue)}
              onAddToQueue={() => musicPlayer.addToQueue(queueTrack)}
              onLike={() => void likeTrack(queueTrack)}
            >
              <div
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900/80 md:px-12",
                  isActive && "bg-zinc-900 text-white",
                )}
              >
                <span className="w-8 shrink-0 text-center text-sm text-zinc-500">
                  {isActive && musicPlayer.playing ? "▶" : index + 1}
                </span>
                <ProgressiveCoverImage
                  src={track.imageUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm",
                      isActive ? "text-red-400" : "text-white",
                    )}
                  >
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {track.artists.join(", ") || track.albumName}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatTrackDuration(track.durationMs)}
                </span>
              </div>
            </SwipeableTrackRow>
          );
        })}
      </div>
    </section>
  );
}
