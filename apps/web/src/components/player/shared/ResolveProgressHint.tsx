import { useEffect, useState } from "react";

const REAL_DEBRID_TORRENTS_URL = "https://real-debrid.com/torrents";
const SLOW_RESOLVE_HINT_MS = 10_000;

type ResolveProgressHintProps = {
  /** When true, start/reset the 10s timer for the torrents link. */
  active: boolean;
  progress?: string | null;
  className?: string;
  onChooseAnotherStream?: () => void;
};

/**
 * Shows live download progress and offers alternatives while Real Debrid prepares a stream.
 */
export function ResolveProgressHint({
  active,
  progress,
  className,
  onChooseAnotherStream,
}: ResolveProgressHintProps) {
  const [showTorrentsLink, setShowTorrentsLink] = useState(false);

  useEffect(() => {
    if (!active) {
      setShowTorrentsLink(false);
      return;
    }

    setShowTorrentsLink(false);
    const timer = window.setTimeout(() => {
      setShowTorrentsLink(true);
    }, SLOW_RESOLVE_HINT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [active]);

  if (!active) {
    return null;
  }

  const downloading =
    /^(Downloading on Real Debrid|Waiting for Real Debrid)/i.test(
      progress ?? "",
    );
  const percentageMatch = downloading
    ? progress?.match(/(\d+(?:\.\d+)?)%/)
    : null;
  // Older servers omit the percentage until the download has made progress.
  const percentage = percentageMatch
    ? Math.min(100, Math.max(0, Number(percentageMatch[1])))
    : /\(downloading\)/i.test(progress ?? "")
      ? 0
      : null;

  return (
    <div className={className}>
      <p className="mx-auto max-w-md px-4 text-center" aria-live="polite">
        {downloading
          ? "This one isn’t ready yet. We’re downloading it so you can play it on JedFlix."
          : progress ?? "Preparing your stream…"}
      </p>
      {downloading ? (
        <div className="mx-auto mt-4 w-full max-w-md px-4">
          <div className="mb-2 flex justify-between gap-4 text-sm text-zinc-400">
            <span>
              {percentage === null
                ? "Waiting for the download to start"
                : "Downloading"}
            </span>
            {percentage !== null ? <span>{percentage}%</span> : null}
          </div>
          <div
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage ?? undefined}
            className="h-2 overflow-hidden rounded-full bg-zinc-700"
          >
            <div
              className={
                percentage === null
                  ? "h-full w-1/3 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none"
                  : "h-full rounded-full bg-red-600 transition-[width] duration-500 motion-reduce:transition-none"
              }
              style={
                percentage === null ? undefined : { width: `${percentage}%` }
              }
            />
          </div>
          <p className="mt-3 text-center text-sm text-zinc-400">
            You can safely close this window. The download will continue on Real
            Debrid. You can also try another stream that may already be ready to
            play.
          </p>
          {onChooseAnotherStream ? (
            <button
              type="button"
              onClick={onChooseAnotherStream}
              className="mx-auto mt-3 block rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            >
              Try another stream
            </button>
          ) : null}
        </div>
      ) : null}
      {showTorrentsLink ? (
        <p className="mx-auto mt-3 max-w-md px-4 text-center text-sm text-zinc-400">
          <a
            href={REAL_DEBRID_TORRENTS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-red-400 underline underline-offset-2 hover:text-red-300"
          >
            View downloads on Real Debrid
          </a>
        </p>
      ) : null}
    </div>
  );
}
