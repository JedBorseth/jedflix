import { useState } from "react";
import {
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { DownloadIcon, PlusIcon, StackIcon } from "@radix-ui/react-icons";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { ImportPlaylistDialog } from "@/components/library/ImportPlaylistDialog";
import { AppLink } from "@/components/layout/AppLink";
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

export function MusicLibraryPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-6xl px-4 pb-36 md:px-12 md:pb-32">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Library</h1>
            <p className="mt-1 text-sm text-zinc-400">Your playlists</p>
          </div>
        </div>

        <Unauthenticated>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="mb-4 text-zinc-300">Sign in to manage your playlists.</p>
            <Button asChild className="bg-red-600 hover:bg-red-700">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </div>
        </Unauthenticated>

        <Authenticated>
          <LibraryPlaylists />
        </Authenticated>
      </main>
    </div>
  );
}

function LibraryPlaylists() {
  const playlists = useQuery(api.playlists.list);
  const createPlaylist = useMutation(api.playlists.create);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a playlist name");
      return;
    }
    setBusy(true);
    try {
      await createPlaylist({ name: trimmed });
      toast.success(`Created “${trimmed}”`);
      setName("");
      setDialogOpen(false);
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not create playlist",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        <Button
          type="button"
          className="bg-red-600 hover:bg-red-700"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Create playlist
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-zinc-700 text-zinc-200 hover:bg-zinc-900 hover:text-white"
          onClick={() => setImportOpen(true)}
        >
          <DownloadIcon className="mr-2 h-4 w-4" />
          Import from Spotify
        </Button>
      </div>

      {playlists === undefined ? (
        <p className="text-sm text-zinc-500">Loading playlists…</p>
      ) : playlists.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <StackIcon className="mx-auto mb-3 h-8 w-8 text-zinc-500" />
          <p className="mb-2 text-zinc-300">No playlists yet</p>
          <p className="mb-4 text-sm text-zinc-500">
            Create a playlist, or import your Spotify library.
          </p>
          <Button
            type="button"
            variant="outline"
            className="border-zinc-600"
            onClick={() => setImportOpen(true)}
          >
            <DownloadIcon className="mr-2 h-4 w-4" />
            Import from Spotify
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-900">
          {playlists.map((playlist) => (
            <li key={playlist._id}>
              <AppLink
                to={`/music/playlist/${playlist._id}`}
                className="flex items-center gap-3 py-3 transition-colors hover:bg-zinc-900/60"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-800">
                  {playlist.coverImageUrl ? (
                    <img
                      src={playlist.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <StackIcon className="h-5 w-5 text-zinc-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{playlist.name}</p>
                  <p className="truncate text-sm text-zinc-500">
                    {playlist.trackCount.toLocaleString()}{" "}
                    {playlist.trackCount === 1 ? "song" : "songs"}
                  </p>
                </div>
              </AppLink>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create playlist</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Give your playlist a name.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My playlist"
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
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={() => void handleCreate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportPlaylistDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
