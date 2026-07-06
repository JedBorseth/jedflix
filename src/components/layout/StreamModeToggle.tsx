import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getStreamMode, setStreamMode } from "@/lib/streamMode";
import type { StreamMode } from "@/lib/streamApi";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type StreamModeControlProps = {
  className?: string;
  itemClassName?: string;
};

export function StreamModeControl({
  className,
  itemClassName,
}: StreamModeControlProps) {
  const [mode, setMode] = useState<StreamMode>(() => getStreamMode());

  useEffect(() => {
    setStreamMode(mode);
  }, [mode]);

  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(value) => {
        if (value === "direct" || value === "proxy") {
          setMode(value);
        }
      }}
      className={cn("rounded-md border border-zinc-700 bg-black/50 p-0.5", className)}
      aria-label="Stream delivery mode"
    >
      <ToggleGroupItem
        value="direct"
        className={cn(
          "h-7 px-2 text-xs data-[state=on]:bg-zinc-800 data-[state=on]:text-white",
          itemClassName,
        )}
      >
        Direct
      </ToggleGroupItem>
      <ToggleGroupItem
        value="proxy"
        className={cn(
          "h-7 px-2 text-xs data-[state=on]:bg-zinc-800 data-[state=on]:text-white",
          itemClassName,
        )}
      >
        Proxy
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function StreamModeToggle() {
  return <StreamModeControl className="hidden md:flex" />;
}
