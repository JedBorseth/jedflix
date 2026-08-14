import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type TrackRowMenuProps = {
  onAddToQueue: () => void;
  onPlayNext: () => void;
};

/** Desktop-only overflow menu for queue actions. Hidden on mobile (swipe instead). */
export function TrackRowMenu({ onAddToQueue, onPlayNext }: TrackRowMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More track actions"
          className={cn(
            "hidden p-1 text-zinc-400 transition-opacity hover:text-white md:inline-flex",
            open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DotsHorizontalIcon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[10rem] border-zinc-800 bg-zinc-950 text-zinc-100"
      >
        <DropdownMenuItem
          className="cursor-pointer focus:bg-zinc-800 focus:text-white"
          onSelect={() => onPlayNext()}
        >
          Play next
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer focus:bg-zinc-800 focus:text-white"
          onSelect={() => onAddToQueue()}
        >
          Add to queue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
