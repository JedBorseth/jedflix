import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isMediaReleased, type MediaItem } from "@/lib/types";

type MediaPlayButtonProps = {
  media: Pick<MediaItem, "releaseDate" | "year">;
  to: string;
  label?: string;
  className?: string;
  useAnchor?: boolean;
};

export function MediaPlayButton({
  media,
  to,
  label = "Play",
  className,
  useAnchor = false,
}: MediaPlayButtonProps) {
  const notReleased = !isMediaReleased(media);

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
        className={cn("bg-white text-black hover:bg-zinc-200", className)}
      >
        {useAnchor ? <a href={to}>{label}</a> : <Link to={to}>{label}</Link>}
      </Button>
    </div>
  );
}
