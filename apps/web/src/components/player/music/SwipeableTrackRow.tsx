import { PlusIcon } from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const SWIPE_QUEUE_DISTANCE = 72;
const SWIPE_QUEUE_VELOCITY = 0.35;
const MAX_REVEAL = 88;

type SwipeableTrackRowProps = {
  onPlay: () => void;
  onAddToQueue: () => void;
  className?: string;
  children: ReactNode;
};

/**
 * Full-width track row: tap to play, swipe right to append to the play queue.
 */
export function SwipeableTrackRow({
  onPlay,
  onAddToQueue,
  className,
  children,
}: SwipeableTrackRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [queuedFlash, setQueuedFlash] = useState(false);

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

      const shouldQueue =
        mx > SWIPE_QUEUE_DISTANCE &&
        absX > absY &&
        (vx > SWIPE_QUEUE_VELOCITY || mx > 120);

      setOffsetX(0);
      if (shouldQueue) {
        onAddToQueue();
        setQueuedFlash(true);
        window.setTimeout(() => setQueuedFlash(false), 900);
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
    <li className={cn("relative overflow-hidden", className)}>
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
        className="relative bg-zinc-950"
        style={{
          transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined,
          transition: offsetX === 0 ? "transform 180ms ease" : undefined,
        }}
        {...bind()}
        role="button"
        tabIndex={0}
        aria-label="Play track. Swipe right to add to queue."
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPlay();
          }
        }}
      >
        {children}
      </div>
    </li>
  );
}
