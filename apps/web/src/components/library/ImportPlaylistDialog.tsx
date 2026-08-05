import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HeartFilledIcon } from "@radix-ui/react-icons";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { useSpotifyLink } from "@/components/party/useSpotifyLink";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SpotifyPlaylistPick = {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string | null;
  isOwner: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImportPlaylistDialog({ open, onOpenChange }: Props) {
  const listLibrary = useAction(api.spotifyImport.listLibraryForImport);
  const startImport = useAction(api.spotifyImport.startImport);
  const { account, loading, configured, connecting, connect } = useSpotifyLink();

  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [likedCount, setLikedCount] = useState(0);
  const [playlists, setPlaylists] = useState<SpotifyPlaylistPick[]>([]);
  const [importLiked, setImportLiked] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  const canImport = account?.canImportPlaylists === true;

  const loadLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    try {
      const result = await listLibrary({});
      setLikedCount(result.likedSongs.trackCount);
      setPlaylists(result.playlists);
      setImportLiked(result.likedSongs.trackCount > 0);
      // Default-select playlists Spotify still lets us read (owned / collab).
      setSelectedIds(
        new Set(
          result.playlists
            .filter((playlist) => playlist.isOwner || playlist.trackCount > 0)
            .map((playlist) => playlist.id),
        ),
      );
    } catch (error: unknown) {
      console.error(error);
      setLibraryError(
        error instanceof Error ? error.message : "Could not load Spotify library",
      );
    } finally {
      setLoadingLibrary(false);
    }
  }, [listLibrary]);

  useEffect(() => {
    if (!open || !account || !canImport) {
      return;
    }
    void loadLibrary();
  }, [open, account, canImport, loadLibrary]);

  const selectedCount = selectedIds.size + (importLiked ? 1 : 0);
  const estimatedTracks = useMemo(() => {
    let total = importLiked ? likedCount : 0;
    for (const playlist of playlists) {
      if (selectedIds.has(playlist.id)) {
        total += playlist.trackCount;
      }
    }
    return total;
  }, [importLiked, likedCount, playlists, selectedIds]);

  function togglePlaylist(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(playlists.map((playlist) => playlist.id)));
    if (likedCount > 0) {
      setImportLiked(true);
    }
  }

  function selectNone() {
    setSelectedIds(new Set());
    setImportLiked(false);
  }

  async function handleStart() {
    if (selectedCount === 0) {
      toast.error("Pick Liked Songs and/or at least one playlist");
      return;
    }
    setStarting(true);
    try {
      await startImport({
        importLikedSongs: importLiked,
        playlists: playlists
          .filter((playlist) => selectedIds.has(playlist.id))
          .map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            imageUrl: playlist.imageUrl,
          })),
      });
      toast.loading("Starting Spotify import…", {
        id: "spotify-import-job",
        duration: Infinity,
      });
      onOpenChange(false);
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not start import",
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-zinc-800 bg-zinc-950 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Spotify</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Choose Liked Songs and playlists to copy into JedFlix. Large libraries
            import in the background — you can keep browsing.
          </DialogDescription>
        </DialogHeader>

        {!configured ? (
          <p className="text-sm text-zinc-500">
            Spotify is not configured on this server.
          </p>
        ) : loading ? (
          <p className="text-sm text-zinc-500">Checking Spotify connection…</p>
        ) : !account ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Connect your Spotify account to import playlists and liked songs.
            </p>
            <Button
              type="button"
              className="bg-[#1DB954] text-black hover:bg-[#1ed760]"
              disabled={connecting}
              onClick={() => void connect("/music/library")}
            >
              {connecting ? "Opening Spotify…" : "Connect Spotify"}
            </Button>
          </div>
        ) : !canImport ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Your Spotify connection is missing library permission. Reconnect to
              allow JedFlix to read playlists and liked songs.
            </p>
            <Button
              type="button"
              className="bg-[#1DB954] text-black hover:bg-[#1ed760]"
              disabled={connecting}
              onClick={() => void connect("/music/library")}
            >
              {connecting ? "Opening Spotify…" : "Reconnect Spotify"}
            </Button>
          </div>
        ) : loadingLibrary ? (
          <p className="text-sm text-zinc-500">Loading your Spotify library…</p>
        ) : libraryError ? (
          <div className="space-y-3">
            <p className="text-sm text-red-400">{libraryError}</p>
            <Button
              type="button"
              variant="outline"
              className="border-zinc-700"
              onClick={() => void loadLibrary()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span>
                {selectedCount} selected · ~{estimatedTracks.toLocaleString()} songs
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="hover:text-white"
                  onClick={selectAll}
                >
                  Select all
                </button>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="hover:text-white"
                  onClick={selectNone}
                >
                  None
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border border-zinc-800">
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/80",
                  importLiked && "bg-zinc-900/50",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-red-600"
                  checked={importLiked}
                  disabled={likedCount === 0}
                  onChange={(event) => setImportLiked(event.target.checked)}
                />
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gradient-to-br from-rose-600 to-rose-900">
                  <HeartFilledIcon className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">Liked Songs</p>
                  <p className="truncate text-xs text-zinc-500">
                    {likedCount.toLocaleString()}{" "}
                    {likedCount === 1 ? "song" : "songs"} · saves to Liked Songs
                  </p>
                </div>
              </label>

              {playlists.length === 0 ? (
                <p className="px-3 py-4 text-sm text-zinc-500">
                  No Spotify playlists found on this account.
                </p>
              ) : (
                playlists.map((playlist) => {
                  const checked = selectedIds.has(playlist.id);
                  return (
                    <label
                      key={playlist.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/80",
                        checked && "bg-zinc-900/50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-red-600"
                        checked={checked}
                        onChange={() => togglePlaylist(playlist.id)}
                      />
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-800">
                        {playlist.imageUrl ? (
                          <img
                            src={playlist.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-[10px] text-zinc-500">N/A</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {playlist.name}
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          {playlist.trackCount.toLocaleString()}{" "}
                          {playlist.trackCount === 1 ? "song" : "songs"}
                          {playlist.isOwner
                            ? " · yours"
                            : playlist.ownerName
                              ? ` · ${playlist.ownerName}`
                              : ""}
                          {!playlist.isOwner
                            ? " · may be blocked by Spotify"
                            : ""}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            className="border-zinc-700"
            disabled={starting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-red-600 hover:bg-red-700"
            disabled={
              starting ||
              !account ||
              !canImport ||
              loadingLibrary ||
              Boolean(libraryError) ||
              selectedCount === 0
            }
            onClick={() => void handleStart()}
          >
            {starting ? "Starting…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
