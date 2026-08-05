import { Authenticated, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";

const TOAST_ID = "spotify-import-job";

function formatImportMessage(job: {
  status: "running" | "completed" | "failed";
  completedItems: number;
  totalItems: number;
  importedTracks: number;
  skippedTracks: number;
  currentLabel: string | null;
  error: string | null;
}) {
  if (job.status === "running") {
    const label = job.currentLabel ? ` · ${job.currentLabel}` : "";
    return `Importing from Spotify… ${job.importedTracks.toLocaleString()} songs${label}`;
  }
  if (job.status === "failed") {
    return job.error ?? "Spotify import failed";
  }
  const skipped =
    job.skippedTracks > 0
      ? ` (${job.skippedTracks.toLocaleString()} skipped)`
      : "";
  return `Imported ${job.importedTracks.toLocaleString()} songs from Spotify${skipped}`;
}

/**
 * Keeps a sonner toast in sync with the Convex import job so progress survives
 * client-side navigation across the app.
 */
function ImportJobToaster() {
  const job = useQuery(api.spotifyImport.getActiveJob);
  const lastStatus = useRef<string | null>(null);

  useEffect(() => {
    if (!job) {
      if (lastStatus.current === "running") {
        toast.dismiss(TOAST_ID);
      }
      lastStatus.current = null;
      return;
    }

    const description =
      job.status === "running"
        ? `${job.completedItems}/${job.totalItems} playlists`
        : undefined;
    const message = formatImportMessage(job);

    if (job.status === "running") {
      toast.loading(message, {
        id: TOAST_ID,
        description,
        duration: Infinity,
      });
    } else if (job.status === "completed") {
      toast.success(message, {
        id: TOAST_ID,
        duration: 8_000,
      });
    } else {
      toast.error(message, {
        id: TOAST_ID,
        duration: 12_000,
      });
    }
    lastStatus.current = job.status;
  }, [job]);

  return null;
}

export function SpotifyImportProgress() {
  return (
    <Authenticated>
      <ImportJobToaster />
    </Authenticated>
  );
}
