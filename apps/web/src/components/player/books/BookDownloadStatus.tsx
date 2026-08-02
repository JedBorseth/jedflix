import type { StreamSource } from "@/lib/streamApi";

type BookDownloadStatusProps = {
  source: StreamSource;
  progress?: string;
  mediaLabel: "audiobook" | "ebook";
  onCancel: () => void;
};

function parsePercent(progress?: string): number | null {
  if (!progress) {
    return null;
  }
  const match = progress.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function formatSize(sizeGb?: number): string | null {
  if (sizeGb === undefined) {
    return null;
  }
  if (sizeGb < 1) {
    return `${(sizeGb * 1024).toFixed(0)} MB`;
  }
  return `${sizeGb.toFixed(2)} GB`;
}

export function BookDownloadStatus({
  source,
  progress,
  mediaLabel,
  onCancel,
}: BookDownloadStatusProps) {
  const percent = parsePercent(progress);
  const size = formatSize(source.sizeGb);
  const indeterminate = percent === null;

  return (
    <div className="mx-auto w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 md:p-8">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
        Real Debrid download
      </p>
      <h2 className="mt-2 text-xl font-semibold text-white">Preparing your {mediaLabel}</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Playback starts after Real Debrid finishes caching this torrent. Slow or zero-seeder
        sources can take a while — you can cancel and pick another.
      </p>

      <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <p className="text-sm font-medium text-white">{source.title}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          {size ? <span>{size}</span> : null}
          {source.seeders !== undefined ? <span>{source.seeders} seeders (listing)</span> : null}
          {source.info ? <span className="line-clamp-1">{source.info}</span> : null}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-zinc-300">{progress ?? "Starting Real Debrid…"}</span>
          {percent !== null ? <span className="tabular-nums text-zinc-400">{percent}%</span> : null}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          {indeterminate ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-red-600/80" />
          ) : (
            <div
              className="h-full rounded-full bg-red-600 transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-md border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-400 hover:text-white"
          onClick={onCancel}
        >
          Cancel & pick another
        </button>
        <p className="text-xs text-zinc-600">
          Live seeders and speed update while Real Debrid is downloading.
        </p>
      </div>
    </div>
  );
}
