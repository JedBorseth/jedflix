import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Authenticated,
  Unauthenticated,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import {
  DotsHorizontalIcon,
  Pencil1Icon,
  PlayIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { VirtualTrackList } from "@/components/library/VirtualTrackList";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import {
  DEFAULT_PLAYLIST_SORT,
  PLAYLIST_SORT_OPTIONS,
  sortPlaylistTracks,
  type PlaylistSortKey,
} from "@/lib/playlistSort";
import { shuffleItems } from "@/lib/musicSearch";
import { formatTrackDuration } from "@/lib/spotify";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

function ShuffleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

export function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();

  if (!playlistId) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <main className="pt-navbar px-4 md:px-12">
          <p className="text-zinc-400">Playlist not found.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-6xl pb-36 md:pb-32">
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
  const { results, status, loadMore } = usePaginatedQuery(
    api.playlists.listTracksPage,
    { playlistId },
    { initialNumItems: PAGE_SIZE },
  );
  const removePlaylist = useMutation(api.playlists.remove);
  const renamePlaylist = useMutation(api.playlists.rename);
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const activeTrackId = musicPlayer.current?.id;

  const [shuffle, setShuffle] = useState(false);
  const [sortBy, setSortBy] = useState<PlaylistSortKey>(DEFAULT_PLAYLIST_SORT);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  /** Active playTrack generation — used to append pages without clobbering a newer session. */
  const queueSessionRef = useRef<number | null>(null);
  const pendingShufflePlayRef = useRef(false);

  const sortedTracks = useMemo(
    () => sortPlaylistTracks(results, sortBy),
    [results, sortBy],
  );

  const queue: MusicQueueTrack[] = useMemo(
    () =>
      sortedTracks.map((track) => ({
        id: track.id,
        title: track.title,
        artists: track.artists,
        artistIds: track.artistIds,
        albumName: track.albumName,
        albumId: track.albumId,
        imageUrl: track.imageUrl,
        durationMs: track.durationMs,
      })),
    [sortedTracks],
  );

  // While a playlist is playing (or shuffle is waiting), keep pulling pages into the queue.
  useEffect(() => {
    const needsPages =
      queueSessionRef.current !== null || pendingShufflePlayRef.current;
    if (!needsPages || status !== "CanLoadMore") {
      return;
    }
    loadMore(PAGE_SIZE);
  }, [status, loadMore, results.length]);

  // Finish a deferred shuffle once every page is loaded.
  useEffect(() => {
    if (!pendingShufflePlayRef.current) {
      return;
    }
    if (status === "CanLoadMore" || status === "LoadingMore") {
      return;
    }
    pendingShufflePlayRef.current = false;
    if (queue.length === 0) {
      return;
    }
    const shuffled = shuffleItems(queue);
    const start = shuffled[0];
    if (!start) {
      return;
    }
    queueSessionRef.current = musicPlayer.playTrack(start, shuffled);
  }, [musicPlayer, queue, status]);

  // Extend the player queue as Convex pagination delivers more tracks.
  useEffect(() => {
    const session = queueSessionRef.current;
    if (session === null || shuffle) {
      return;
    }
    musicPlayer.extendQueueFromSource(queue, session);
  }, [musicPlayer, queue, shuffle]);

  const handleNearEnd = useCallback(() => {
    if (status === "CanLoadMore") {
      loadMore(PAGE_SIZE);
    }
  }, [status, loadMore]);

  const playPlaylist = useCallback(
    (startIndex = 0) => {
      if (queue.length === 0) {
        return;
      }
      if (shuffle) {
        if (status === "CanLoadMore" || status === "LoadingMore") {
          pendingShufflePlayRef.current = true;
          toast.message("Loading playlist for shuffle…");
          if (status === "CanLoadMore") {
            loadMore(PAGE_SIZE);
          }
          return;
        }
        const shuffled = shuffleItems(queue);
        const start = shuffled[0];
        if (!start) {
          return;
        }
        queueSessionRef.current = musicPlayer.playTrack(start, shuffled);
        return;
      }
      const start = queue[Math.min(Math.max(startIndex, 0), queue.length - 1)];
      if (!start) {
        return;
      }
      queueSessionRef.current = musicPlayer.playTrack(start, queue);
      if (status === "CanLoadMore") {
        loadMore(PAGE_SIZE);
      }
    },
    [loadMore, musicPlayer, queue, shuffle, status],
  );

  const openRename = useCallback(() => {
    if (!playlist) {
      return;
    }
    setRenameValue(playlist.name);
    setRenameOpen(true);
  }, [playlist]);

  const handleRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("Enter a playlist name");
      return;
    }
    setRenameBusy(true);
    try {
      await renamePlaylist({ playlistId, name: trimmed });
      toast.success("Playlist renamed");
      setRenameOpen(false);
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not rename playlist",
      );
    } finally {
      setRenameBusy(false);
    }
  }, [playlistId, renamePlaylist, renameValue]);

  const handleDeletePlaylist = useCallback(() => {
    if (!playlist) {
      return;
    }
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
  }, [navigate, playlist, playlistId, removePlaylist]);

  if (playlist === undefined || status === "LoadingFirstPage") {
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
          <Link to="/music/library">My Library</Link>
        </Button>
      </div>
    );
  }

  // Prefer position order so the cover doesn't jump when the user changes sort.
  const cover = playlist.trackCount > 0 ? results[0]?.imageUrl : undefined;
  const loadingMore = status === "LoadingMore" || status === "CanLoadMore";
  const sortLabel =
    PLAYLIST_SORT_OPTIONS.find((option) => option.value === sortBy)?.label ??
    "Date added";

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

        <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Playlist
                </p>
                <h1 className="truncate text-3xl font-bold tracking-tight">
                  {playlist.name}
                </h1>
                <p className="mt-1 text-sm text-zinc-400">
                  {playlist.trackCount.toLocaleString()}{" "}
                  {playlist.trackCount === 1 ? "song" : "songs"}
                  {loadingMore && results.length < playlist.trackCount
                    ? ` · loaded ${results.length.toLocaleString()}`
                    : ""}
                </p>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="mt-1 shrink-0 rounded-full p-2 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    aria-label="Playlist options"
                  >
                    <DotsHorizontalIcon className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-44 border-zinc-800 bg-zinc-950 text-zinc-100"
                >
                  <DropdownMenuItem
                    className="cursor-pointer focus:bg-zinc-900 focus:text-white"
                    onSelect={() => openRename()}
                  >
                    <Pencil1Icon className="mr-2 h-4 w-4" />
                    Edit title
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer text-red-400 focus:bg-zinc-900 focus:text-red-400"
                    onSelect={() => handleDeletePlaylist()}
                  >
                    <TrashIcon className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {playlist.trackCount > 0 ? (
            <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playPlaylist(0)}
                  aria-label="Play playlist"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-black shadow-lg transition hover:scale-105 hover:bg-red-500"
                >
                  <PlayIcon className="h-6 w-6 translate-x-0.5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={() => setShuffle((value) => !value)}
                  aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
                  aria-pressed={shuffle}
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-zinc-800",
                    shuffle ? "text-red-500" : "text-white",
                  )}
                >
                  <ShuffleIcon className="h-5 w-5" />
                </button>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
                    aria-label="Sort playlist"
                  >
                    Sort: {sortLabel}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-44 border-zinc-800 bg-zinc-950 text-zinc-100"
                >
                  <DropdownMenuRadioGroup
                    value={sortBy}
                    onValueChange={(value) =>
                      setSortBy(value as PlaylistSortKey)
                    }
                  >
                    {PLAYLIST_SORT_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        className="cursor-pointer focus:bg-zinc-900 focus:text-white"
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </div>

      {playlist.trackCount === 0 ? (
        <div className="mx-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center md:mx-12">
          <p className="mb-2 text-zinc-300">This playlist is empty.</p>
          <p className="text-sm text-zinc-500">
            Open the fullscreen player and tap the + button next to the song title.
          </p>
        </div>
      ) : (
        <VirtualTrackList
          items={sortedTracks}
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
                onPlay={() => {
                  if (shuffle) {
                    const rest = shuffleItems(
                      queue.filter((item) => item.id !== queueTrack.id),
                    );
                    queueSessionRef.current = musicPlayer.playTrack(
                      queueTrack,
                      [queueTrack, ...rest],
                    );
                    return;
                  }
                  queueSessionRef.current = musicPlayer.playTrack(
                    queueTrack,
                    queue,
                  );
                  if (status === "CanLoadMore") {
                    loadMore(PAGE_SIZE);
                  }
                }}
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
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit title</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Rename this playlist.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="Playlist name"
            className="border-zinc-700 bg-zinc-900 text-white"
            autoFocus
            maxLength={100}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleRename();
              }
            }}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-zinc-700"
              disabled={renameBusy}
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-600 hover:bg-red-700"
              disabled={renameBusy}
              onClick={() => void handleRename()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
