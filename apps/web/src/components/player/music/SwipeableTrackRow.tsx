import { HeartFilledIcon, HeartIcon, PlusIcon } from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useState, type ReactNode } from "react";
import { TrackRowMenu } from "@/components/player/music/TrackRowMenu";
import { cn } from "@/lib/utils";

const SWIPE_ACTION_DISTANCE = 72;
const SWIPE_ACTION_VELOCITY = 0.35;
const MAX_REVEAL = 88;

type SwipeableTrackRowProps = {
  onPlay: () => void;
  onAddToQueue: () => void;
  onPlayNext: () => void;
  onLike: () => void;
  className?: string;
  children: ReactNode;
};

/**
 * Full-width track row: tap to play, swipe right to queue, swipe left to like.
 */
export function SwipeableTrackRow({
  onPlay,
  onAddToQueue,
  onPlayNext,
  onLike,
  className,
  children,
}: SwipeableTrackRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [queuedFlash, setQueuedFlash] = useState(false);
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
        if (absX > absY) {
          setOffsetX(Math.max(-MAX_REVEAL, Math.min(MAX_REVEAL, mx)));
        }
        return;
      }

      if (!last) {
        return;
      }

      const horizontal = absX > absY;
      const triggered =
        horizontal && (vx > SWIPE_ACTION_VELOCITY || absX > 120);

      setOffsetX(0);

      if (triggered && mx > SWIPE_ACTION_DISTANCE) {
        onAddToQueue();
        setQueuedFlash(true);
        window.setTimeout(() => setQueuedFlash(false), 900);
        return;
      }

      if (triggered && mx < -SWIPE_ACTION_DISTANCE) {
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
    <div className={cn("group relative overflow-hidden", className)}>
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex w-24 items-center gap-1.5 bg-emerald-600 px-3 text-sm font-medium text-white transition-opacity",
          offsetX > 12 || queuedFlash ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        <PlusIcon className="h-4 w-4" />
        {queuedFlash ? "Added" : "Queue"}
      </div>
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-24 items-center justify-end gap-1.5 bg-rose-600 px-3 text-sm font-medium text-white transition-opacity",
          offsetX < -12 || likedFlash ? "opacity-100" : "opacity-0",
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
        aria-label="Play track. Swipe right to add to queue. Swipe left to like."
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPlay();
          }
        }}
      >
        <div className="md:pr-8">{children}</div>
        <div className="pointer-events-none absolute inset-y-0 right-2 z-10 hidden items-center md:flex md:right-8">
          <div className="pointer-events-auto">
            <TrackRowMenu onAddToQueue={onAddToQueue} onPlayNext={onPlayNext} />
          </div>
        </div>
      </div>
    </div>
  );
}
