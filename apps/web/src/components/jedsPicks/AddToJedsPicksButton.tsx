import { CheckIcon, PlusIcon } from "@radix-ui/react-icons";
import { useJedsPicks } from "@/components/jedsPicks/jedsPicksContext";
import type { JedsPickIdentity } from "@/lib/jedsPicks";
import { cn } from "@/lib/utils";

type AddToJedsPicksButtonProps = {
  item: JedsPickIdentity;
  className?: string;
};

export function AddToJedsPicksButton({
  item,
  className,
}: AddToJedsPicksButtonProps) {
  const { canManage, isPicked, togglePick } = useJedsPicks();
  if (!canManage) {
    return null;
  }

  const picked = isPicked(item);
  const label = picked ? "Remove from Jed's Picks" : "Add to Jed's Picks";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/75 text-white shadow-md transition hover:bg-red-600",
        picked && "bg-red-600 hover:bg-red-700",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void togglePick(item);
      }}
    >
      {picked ? (
        <CheckIcon className="h-4 w-4" />
      ) : (
        <PlusIcon className="h-4 w-4" />
      )}
    </button>
  );
}
