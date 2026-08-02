import { PersonIcon } from "@radix-ui/react-icons";
import { useOptionalParty } from "@/components/party/partyContext";
import { cn } from "@/lib/utils";

/** Entry point into party mode for pages where the player bar may be hidden. */
export function PartyStatusButton({ className }: { className?: string }) {
  const party = useOptionalParty();
  if (!party) {
    return null;
  }

  const active = party.party;
  return (
    <button
      type="button"
      onClick={() => party.setPanelOpen(true)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-800 hover:text-white",
        className,
      )}
    >
      <PersonIcon className="h-4 w-4" />
      {active ? (
        <span>
          Party <span className="font-mono tracking-widest">{active.code}</span> ·{" "}
          {active.members.length}
        </span>
      ) : (
        <span>Party mode</span>
      )}
    </button>
  );
}
