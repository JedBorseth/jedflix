import { cn } from "@/lib/utils";

export type SearchResultRowClassNameOptions = {
  compact?: boolean;
  isActive?: boolean;
  disabled?: boolean;
};

export function searchResultRowClassName({
  compact,
  isActive,
  disabled,
}: SearchResultRowClassNameOptions = {}) {
  return cn(
    "flex w-full items-center gap-3 text-left transition-colors",
    compact
      ? "px-3 py-2 hover:bg-zinc-800"
      : "px-4 py-3 hover:bg-zinc-900/80 md:px-12",
    isActive && "bg-zinc-900",
    disabled && "cursor-not-allowed opacity-50",
  );
}
