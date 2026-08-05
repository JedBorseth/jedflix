import { useCallback, useEffect, useMemo } from "react";
import {
  Authenticated,
  Unauthenticated,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { HeartFilledIcon } from "@radix-ui/react-icons";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { VirtualTrackList } from "@/components/library/VirtualTrackList";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Button } from "@/components/ui/button";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import { formatTrackDuration } from "@/lib/spotify";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

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
  const likedCount = useQuery(api.likedSongs.count);
  const { results, status, loadMore } = usePaginatedQuery(
    api.likedSongs.listPage,
    {},
    { initialNumItems: PAGE_SIZE },
  );
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const activeTrackId = musicPlayer.current?.id;

  useEffect(() => {
    if (status === "CanLoadMore") {
      loadMore(PAGE_SIZE);
    }
  }, [status, loadMore]);

  const queue: MusicQueueTrack[] = useMemo(
    () =>
      results.map((track) => ({
        id: track.id,
        title: track.title,
        artists: track.artists,
        artistIds: track.artistIds,
        albumName: track.albumName,
        albumId: track.albumId,
        imageUrl: track.imageUrl,
        durationMs: track.durationMs,
      })),
    [results],
  );

  const handleNearEnd = useCallback(() => {
    if (status === "CanLoadMore") {
      loadMore(PAGE_SIZE);
    }
  }, [status, loadMore]);

  if (status === "LoadingFirstPage" || likedCount === undefined) {
    return (
      <div className="px-4 md:px-12">
        <p className="text-sm text-zinc-500">Loading liked songs…</p>
      </div>
    );
  }

  if (likedCount === 0) {
    return (
      <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
        <p className="mb-2 text-zinc-300">No liked songs yet.</p>
        <p className="mb-4 text-sm text-zinc-500">
          Swipe left on any song to add it here, or import Liked Songs from Spotify
          in My Library.
        </p>
        <Button asChild variant="outline" className="border-zinc-600">
          <Link to="/music/library">My Library</Link>
        </Button>
      </div>
    );
  }

  const loadingMore = status === "LoadingMore" || status === "CanLoadMore";

  return (
    <section>
      <p className="mb-4 px-4 text-sm text-zinc-400 md:px-12">
        {likedCount.toLocaleString()} {likedCount === 1 ? "song" : "songs"}
        {loadingMore && results.length < likedCount
          ? ` · loaded ${results.length.toLocaleString()}`
          : ""}
      </p>
      <VirtualTrackList
        items={results}
        onNearEnd={handleNearEnd}
        getItemKey={(track) => track._id}
        renderRow={(track, index) => {
          const queueTrack = queue[index];
          if (!queueTrack) {
            return null;
          }
          const isActive = activeTrackId === track.id;
          return (
            <SwipeableTrackRow
              onPlay={() => musicPlayer.playTrack(queueTrack, queue)}
              onAddToQueue={() => musicPlayer.addToQueue(queueTrack)}
              onLike={() => void likeTrack(queueTrack)}
            >
              <div
                className={cn(
                  "flex h-16 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-zinc-900/80 md:px-12",
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
        }}
      />
    </section>
  );
}
