import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { TrashIcon } from "@radix-ui/react-icons";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
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

export function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();

  if (!playlistId) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="music" />
        <main className="pt-navbar px-4 md:px-12">
          <p className="text-zinc-400">Playlist not found.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode="music" />
      <main className="pt-navbar mx-auto max-w-6xl pb-36 md:pb-32">
        <div className="px-4 md:px-12">
          <AppLink
            to="/music/library"
            className="mb-6 inline-block text-sm text-zinc-400 transition hover:text-white"
          >
            ← Back to library
          </AppLink>
        </div>

        <Unauthenticated>
          <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
            <p className="mb-4 text-zinc-300">Sign in to view this playlist.</p>
            <Button asChild className="bg-red-600 hover:bg-red-700">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </div>
        </Unauthenticated>

        <Authenticated>
          <PlaylistDetail playlistId={playlistId as Id<"playlists">} />
        </Authenticated>
      </main>
    </div>
  );
}

function PlaylistDetail({ playlistId }: { playlistId: Id<"playlists"> }) {
  const navigate = useNavigate();
  const playlist = useQuery(api.playlists.get, { playlistId });
  const tracks = useQuery(api.playlists.listTracks, { playlistId });
  const removePlaylist = useMutation(api.playlists.remove);
  const removeTrack = useMutation(api.playlists.removeTrack);
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const activeTrackId = musicPlayer.current?.id;

  if (playlist === undefined || tracks === undefined) {
    return (
      <div className="px-4 md:px-12">
        <p className="text-sm text-zinc-500">Loading playlist…</p>
      </div>
    );
  }

  if (playlist === null) {
    return (
      <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
        <p className="mb-4 text-zinc-300">Playlist not found.</p>
        <Button asChild variant="outline" className="border-zinc-600">
          <Link to="/music/library">Back to library</Link>
        </Button>
      </div>
    );
  }

  const queue: MusicQueueTrack[] = tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName,
    albumId: track.albumId,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
  }));

  const cover = tracks[0]?.imageUrl;

  return (
    <>
      <div className="mb-8 flex items-start gap-4 px-4 md:px-12">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-800 md:h-32 md:w-32">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm text-zinc-500">Empty</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Playlist
          </p>
          <h1 className="truncate text-3xl font-bold tracking-tight">{playlist.name}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-white"
            onClick={() => {
              if (!window.confirm(`Delete playlist “${playlist.name}”?`)) {
                return;
              }
              void removePlaylist({ playlistId })
                .then(() => {
                  toast.success("Playlist deleted");
                  void navigate("/music/library");
                })
                .catch((error: unknown) => {
                  console.error(error);
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Could not delete playlist",
                  );
                });
            }}
          >
            <TrashIcon className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
          <p className="mb-2 text-zinc-300">This playlist is empty.</p>
          <p className="text-sm text-zinc-500">
            Open the fullscreen player and tap the + button next to the song title.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-900">
          {tracks.map((track, index) => {
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
                  <button
                    type="button"
                    className="shrink-0 rounded p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                    aria-label={`Remove ${track.title} from playlist`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeTrack({ playlistId, trackId: track.id })
                        .then(() => toast.success("Removed from playlist"))
                        .catch((error: unknown) => {
                          console.error(error);
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not remove track",
                          );
                        });
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatTrackDuration(track.durationMs)}
                  </span>
                </div>
              </SwipeableTrackRow>
            );
          })}
        </div>
      )}
    </>
  );
}
