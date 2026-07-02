import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getStreamMode, setStreamMode } from "@/lib/streamMode";
import type { StreamMode } from "@/lib/streamApi";
import { useEffect, useState } from "react";

export function StreamModeToggle() {
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
      className="hidden rounded-md border border-zinc-700 bg-black/50 p-0.5 md:flex"
      aria-label="Stream delivery mode"
    >
      <ToggleGroupItem
        value="direct"
        className="h-7 px-2 text-xs data-[state=on]:bg-zinc-800 data-[state=on]:text-white"
      >
        Direct
      </ToggleGroupItem>
      <ToggleGroupItem
        value="proxy"
        className="h-7 px-2 text-xs data-[state=on]:bg-zinc-800 data-[state=on]:text-white"
      >
        Proxy
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
