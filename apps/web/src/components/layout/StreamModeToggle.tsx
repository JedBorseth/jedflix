import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUserSettings } from "@/hooks/useUserSettings";
import { cn } from "@/lib/utils";

type StreamModeControlProps = {
  className?: string;
  itemClassName?: string;
};

export function StreamModeControl({
  className,
  itemClassName,
}: StreamModeControlProps) {
  const { streamMode, saveSettings } = useUserSettings();

  return (
    <ToggleGroup
      type="single"
      value={streamMode}
      onValueChange={(value) => {
        if (value === "direct" || value === "proxy") {
          saveSettings({ streamMode: value });
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
