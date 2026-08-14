import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TrackRowMenuProps = {
  onAddToQueue: () => void;
  onPlayNext: () => void;
};

/** Desktop-only overflow menu for queue actions. Hidden on mobile (swipe instead). */
export function TrackRowMenu({ onAddToQueue, onPlayNext }: TrackRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More track actions"
          className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
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
