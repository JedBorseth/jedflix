import { useEffect, useState } from "react";

const REAL_DEBRID_TORRENTS_URL = "https://real-debrid.com/torrents";
const SLOW_RESOLVE_HINT_MS = 10_000;

type ResolveProgressHintProps = {
  /** When true, start/reset the 10s timer for the torrents link. */
  active: boolean;
  progress?: string | null;
  className?: string;
};

/**
 * Shows Real Debrid resolve progress, and after 10s of waiting offers a link
 * to the RD torrents page so the user can check download status themselves.
 */
export function ResolveProgressHint({
  active,
  progress,
  className,
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

  return (
    <div className={className}>
      <p>{progress ?? "Resolving with Real Debrid…"}</p>
      {showTorrentsLink ? (
        <p className="mt-2 max-w-md px-4 text-center text-sm text-zinc-400">
          Taking a while?{" "}
          <a
            href={REAL_DEBRID_TORRENTS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-red-400 underline underline-offset-2 hover:text-red-300"
          >
            Check download progress on Real-Debrid
          </a>
        </p>
      ) : null}
    </div>
  );
}
