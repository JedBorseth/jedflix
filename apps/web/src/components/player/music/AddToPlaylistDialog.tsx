import { useState } from "react";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckIcon,
  HeartFilledIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AddToPlaylistDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: MusicQueueTrack | null;
};

export function AddToPlaylistDialog({
  open,
  onOpenChange,
  track,
}: AddToPlaylistDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to playlist</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {track
              ? `Choose a playlist for “${track.title}”.`
              : "Choose a playlist."}
          </DialogDescription>
        </DialogHeader>
        <Unauthenticated>
          <div className="space-y-4 py-2 text-center">
            <p className="text-sm text-zinc-300">Sign in to save songs to playlists.</p>
            <Button asChild className="bg-red-600 hover:bg-red-700">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </div>
        </Unauthenticated>
        <Authenticated>
          {track ? (
            <AddToPlaylistDialogInner
              track={track}
              onDone={() => onOpenChange(false)}
            />
          ) : null}
        </Authenticated>
      </DialogContent>
    </Dialog>
  );
}

function AddToPlaylistDialogInner({
  track,
  onDone,
}: {
  track: MusicQueueTrack;
  onDone: () => void;
}) {
  const playlists = useQuery(api.playlists.list);
  const liked = useQuery(api.likedSongs.isLiked, { trackId: track.id });
  const likedCount = useQuery(api.likedSongs.count);
  const createPlaylist = useMutation(api.playlists.create);
  const addTrack = useMutation(api.playlists.addTrack);
  const likeSong = useMutation(api.likedSongs.like);
  const unlikeSong = useMutation(api.likedSongs.unlike);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleLikedSongs() {
    setBusy(true);
    try {
      if (liked) {
        await unlikeSong({ trackId: track.id });
        toast.success("Removed from Liked Songs");
      } else {
        await likeSong({
          track: {
            id: track.id,
            title: track.title,
            artists: track.artists,
            artistIds: track.artistIds,
            albumName: track.albumName,
            albumId: track.albumId,
            imageUrl: track.imageUrl,
            durationMs: track.durationMs,
          },
        });
        toast.success("Added to Liked Songs");
      }
      onDone();
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not update Liked Songs",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addToPlaylist(playlistId: Id<"playlists">, playlistName: string) {
    setBusy(true);
    try {
      const result = await addTrack({
        playlistId,
        track: {
          id: track.id,
          title: track.title,
          artists: track.artists,
          artistIds: track.artistIds,
          albumName: track.albumName,
          albumId: track.albumId,
          imageUrl: track.imageUrl,
          durationMs: track.durationMs,
        },
      });
      toast.success(
        result.added ? `Added to ${playlistName}` : `Already in ${playlistName}`,
      );
      onDone();
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not add to playlist",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("Enter a playlist name");
      return;
    }
    setBusy(true);
    try {
      const playlistId = await createPlaylist({ name });
      await addToPlaylist(playlistId, name);
      setNewName("");
      setCreating(false);
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not create playlist",
      );
      setBusy(false);
    }
  }

  const isLiked = liked === true;

  return (
    <div className="space-y-3">
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        <li>
          <button
            type="button"
            disabled={busy || liked === undefined}
            onClick={() => void toggleLikedSongs()}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-zinc-900 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-gradient-to-br from-rose-600 to-rose-900">
              <HeartFilledIcon className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">Liked Songs</p>
              <p className="truncate text-xs text-zinc-500">
                {likedCount === undefined
                  ? "…"
                  : `${likedCount.toLocaleString()} ${likedCount === 1 ? "song" : "songs"}`}
              </p>
            </div>
            {isLiked ? (
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
                aria-label="Already in Liked Songs"
              >
                <CheckIcon className="h-4 w-4" />
              </span>
            ) : (
              <PlusIcon className="h-5 w-5 shrink-0 text-zinc-500" />
            )}
          </button>
        </li>

        {playlists === undefined ? (
          <li className="px-3 py-2 text-sm text-zinc-500">Loading playlists…</li>
        ) : (
          playlists.map((playlist) => (
            <li key={playlist._id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void addToPlaylist(playlist._id, playlist.name)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-zinc-900 disabled:opacity-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-800">
                  {playlist.coverImageUrl ? (
                    <img
                      src={playlist.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlusIcon className="h-4 w-4 text-zinc-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {playlist.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {playlist.trackCount}{" "}
                    {playlist.trackCount === 1 ? "song" : "songs"}
                  </p>
                </div>
              </button>
            </li>
          ))
        )}
      </ul>

      {playlists !== undefined && playlists.length === 0 && !creating ? (
        <p className={cn("text-sm text-zinc-400")}>
          You don’t have any playlists yet. Create one to get started.
        </p>
      ) : null}

      {creating ? (
        <div className="space-y-3 border-t border-zinc-800 pt-3">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Playlist name"
            className="border-zinc-700 bg-zinc-900 text-white"
            autoFocus
            maxLength={100}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleCreate();
              }
            }}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-zinc-700"
              disabled={busy}
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={() => void handleCreate()}
            >
              Create & add
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full border-zinc-700"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          New playlist
        </Button>
      )}
    </div>
  );
}
