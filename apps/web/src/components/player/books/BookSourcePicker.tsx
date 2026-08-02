import type { StreamSource } from "@/lib/streamApi";

type BookSourcePickerProps = {
  sources: StreamSource[];
  loading: boolean;
  error?: string;
  disabled?: boolean;
  selectedId?: string;
  mediaLabel: "audiobook" | "ebook";
  onSelect: (source: StreamSource) => void;
  onRetry: () => void;
};

function matchPercent(score?: number): string | null {
  if (score === undefined) {
    return null;
  }
  return `${Math.max(0, Math.round((1 - score) * 100))}% match`;
}

function formatSize(sizeGb?: number): string | null {
  if (sizeGb === undefined) {
    return null;
  }
  if (sizeGb < 1) {
    return `${Math.max(1, Math.round(sizeGb * 1024))} MB`;
  }
  return `${sizeGb.toFixed(2)} GB`;
}

export function BookSourcePicker({
  sources,
  loading,
  error,
  disabled = false,
  selectedId,
  mediaLabel,
  onSelect,
  onRetry,
}: BookSourcePickerProps) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 md:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Choose a source</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Results from AudiobookBay, ranked by title match. Prefer smaller files when possible —
          seeders (when listed) and Real Debrid download speed matter more than size for{" "}
          {mediaLabel === "audiobook" ? "listening" : "reading"}.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-10 text-zinc-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
          <p>Searching AudiobookBay...</p>
        </div>
      ) : null}

      {error ? (
        <div className="space-y-3 rounded-md border border-red-900/50 bg-red-950/40 p-4 text-center">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
            onClick={onRetry}
          >
            Retry search
          </button>
        </div>
      ) : null}

      {!loading && !error && sources.length === 0 ? (
        <div className="space-y-3 rounded-md border border-zinc-700 p-4 text-center">
          <p className="text-sm text-zinc-400">No matching sources found.</p>
          <button
            type="button"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
            onClick={onRetry}
          >
            Retry search
          </button>
        </div>
      ) : null}

      <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
        {sources.map((source) => {
          const match = matchPercent(source.matchScore);
          const size = formatSize(source.sizeGb);
          const selected = source.id === selectedId;
          return (
            <li key={source.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(source)}
                className={`w-full rounded-md border px-3 py-3 text-left transition ${
                  selected
                    ? "border-red-500 bg-red-950/40"
                    : "border-zinc-700 bg-zinc-950/60 hover:border-zinc-500"
                } disabled:opacity-50`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-white">{source.title}</p>
                  {match ? (
                    <span className="shrink-0 text-xs text-zinc-400">{match}</span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                  {size ? <span>{size}</span> : null}
                  {source.seeders !== undefined ? (
                    <span
                      className={
                        source.seeders === 0 ? "text-amber-400" : "text-emerald-400/90"
                      }
                    >
                      {source.seeders} seeders
                    </span>
                  ) : (
                    <span className="text-zinc-600">Seeders shown after RD starts</span>
                  )}
                </div>
                {source.info ? (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{source.info}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
