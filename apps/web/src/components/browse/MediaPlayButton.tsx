import { Link } from "react-router-dom";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { useHasRealDebridApiKey } from "@/hooks/useHasRealDebridApiKey";
import { blockDebridMediaNavigation } from "@/lib/debridAccess";
import { cn } from "@/lib/utils";
import { isMediaReleased, type MediaItem } from "@/lib/types";

type MediaPlayButtonProps = {
  media: Pick<MediaItem, "releaseDate" | "year">;
  to: string;
  label?: string;
  className?: string;
  useAnchor?: boolean;
  /** When true, block navigation without a Real Debrid API key. */
  requireDebrid?: boolean;
};

export function MediaPlayButton({
  media,
  to,
  label = "Play",
  className,
  useAnchor = false,
  requireDebrid = false,
}: MediaPlayButtonProps) {
  const notReleased = !isMediaReleased(media);
  const hasDebridKey = useHasRealDebridApiKey();
  const locked = requireDebrid && !hasDebridKey;

  function handleClick(event: MouseEvent) {
    if (requireDebrid && blockDebridMediaNavigation()) {
      event.preventDefault();
    }
  }

  return (
    <div className="relative inline-flex">
      {notReleased ? (
        <span className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
          Not Released
        </span>
      ) : null}
      <Button
        asChild
        size="lg"
        className={cn(
          "bg-white text-black hover:bg-zinc-200",
          locked && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {useAnchor ? (
          <a href={to} aria-disabled={locked} onClick={handleClick}>
            {label}
          </a>
        ) : (
          <Link to={to} aria-disabled={locked} onClick={handleClick}>
            {label}
          </Link>
        )}
      </Button>
    </div>
  );
}
