import { HeartFilledIcon, HeartIcon } from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const SWIPE_LIKE_DISTANCE = 72;
const SWIPE_LIKE_VELOCITY = 0.35;
const MAX_REVEAL = 88;

type SwipeableTrackRowProps = {
  onPlay: () => void;
  onLike: () => void;
  className?: string;
  children: ReactNode;
};

/**
 * Full-width track row: tap to play, swipe right to add to Liked Songs.
 */
export function SwipeableTrackRow({
  onPlay,
  onLike,
  className,
  children,
}: SwipeableTrackRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [likedFlash, setLikedFlash] = useState(false);

  const bind = useDrag(
    ({ down, movement: [mx, my], velocity: [vx], last, tap }) => {
      if (tap) {
        setOffsetX(0);
        onPlay();
        return;
      }

      const absX = Math.abs(mx);
      const absY = Math.abs(my);

      if (down && !last) {
        if (absX > absY && mx > 0) {
          setOffsetX(Math.min(MAX_REVEAL, mx));
        } else if (absX > absY) {
          setOffsetX(0);
        }
        return;
      }

      if (!last) {
        return;
      }

      const shouldLike =
        mx > SWIPE_LIKE_DISTANCE &&
        absX > absY &&
        (vx > SWIPE_LIKE_VELOCITY || mx > 120);

      setOffsetX(0);
      if (shouldLike) {
        onLike();
        setLikedFlash(true);
        window.setTimeout(() => setLikedFlash(false), 900);
      }
    },
    {
      filterTaps: true,
      threshold: 10,
      axis: "x",
      pointer: { touch: true },
    },
  );

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex w-24 items-center gap-1.5 bg-rose-600 px-3 text-sm font-medium text-white transition-opacity",
          offsetX > 12 || likedFlash ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        {likedFlash ? (
          <HeartFilledIcon className="h-4 w-4" />
        ) : (
          <HeartIcon className="h-4 w-4" />
        )}
        {likedFlash ? "Liked" : "Like"}
      </div>
      <div
        className="relative bg-zinc-950"
        style={{
          transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined,
          transition: offsetX === 0 ? "transform 180ms ease" : undefined,
        }}
        {...bind()}
        role="button"
        tabIndex={0}
        aria-label="Play track. Swipe right to like."
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPlay();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
