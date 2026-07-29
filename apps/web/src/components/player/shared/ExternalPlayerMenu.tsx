import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openExternalPlayer } from "@/lib/externalPlayer";
import { cn } from "@/lib/utils";

type ExternalPlayerMenuProps = {
  playbackUrl: string | null;
  className?: string;
  disabled?: boolean;
};

export function ExternalPlayerMenu({
  playbackUrl,
  className,
  disabled = false,
}: ExternalPlayerMenuProps) {
  const canOpen = Boolean(playbackUrl) && !disabled;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("player-mode-badge", !canOpen && "opacity-50", className)}
          disabled={!canOpen}
          aria-label="Open in external player"
        >
          Open in…
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="border-zinc-700 bg-zinc-950 text-white"
      >
        <DropdownMenuItem
          className="cursor-pointer focus:bg-zinc-800 focus:text-white"
          disabled={!canOpen}
          onSelect={() => {
            if (!playbackUrl) return;
            void openExternalPlayer("vlc", playbackUrl);
          }}
        >
          VLC
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer focus:bg-zinc-800 focus:text-white"
          disabled={!canOpen}
          onSelect={() => {
            if (!playbackUrl) return;
            void openExternalPlayer("outplayer", playbackUrl);
          }}
        >
          OutPlayer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
