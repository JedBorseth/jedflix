import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { DesktopIcon, PlayIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getPlaybackDestinationPath,
  type PlaybackPlayer,
} from "@/lib/playbackDestination";

const PLAYERS: Array<{ value: PlaybackPlayer; label: string }> = [
  { value: "web", label: "Web" },
  { value: "vlc", label: "VLC" },
  { value: "outplayer", label: "Outplayer" },
];

type PlaybackDestinationMenuProps = {
  to: string;
  children: ReactElement;
};

export function PlaybackDestinationMenu({
  to,
  children,
}: PlaybackDestinationMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function selectPlayer(player: PlaybackPlayer) {
    setOpen(false);
    void navigate(getPlaybackDestinationPath(to, player));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl border-zinc-800 bg-zinc-950 text-white">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>Where do you want to watch?</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Choose a player to start watching.
          </DialogDescription>
        </DialogHeader>
        <section aria-labelledby="playback-this-device" className="space-y-3">
          <h2
            id="playback-this-device"
            className="flex items-center gap-2 text-sm font-semibold text-zinc-300"
          >
            <DesktopIcon aria-hidden="true" className="h-4 w-4" />
            This device
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {PLAYERS.map((player) => (
              <Button
                key={player.value}
                type="button"
                variant="outline"
                className="h-16 flex-col gap-2 border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800 hover:text-white"
                onClick={() => selectPlayer(player.value)}
              >
                <PlayIcon aria-hidden="true" className="h-4 w-4" />
                {player.label}
              </Button>
            ))}
          </div>
        </section>
        <section
          aria-labelledby="playback-tv"
          className="space-y-2 border-t border-zinc-800 pt-4"
        >
          <h2 id="playback-tv" className="text-sm font-semibold text-zinc-300">
            TV
          </h2>
          <Button
            type="button"
            variant="outline"
            disabled
            className="w-full justify-between border-zinc-800 bg-zinc-900"
          >
            Watch on TV
            <span className="text-xs text-zinc-400">Coming soon</span>
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
