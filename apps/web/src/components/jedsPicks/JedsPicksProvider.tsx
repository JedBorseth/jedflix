import { useMemo, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import {
  JedsPicksContext,
  type JedsPicksContextValue,
} from "@/components/jedsPicks/jedsPicksContext";
import { jedsPickKey, type JedsPickIdentity } from "@/lib/jedsPicks";

export function JedsPicksProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const canManage =
    useQuery(api.jedsPicks.canManage, isAuthenticated ? {} : "skip") === true;
  const picks = useQuery(api.jedsPicks.list);
  const toggle = useMutation(api.jedsPicks.toggle);

  const pickedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pick of picks ?? []) {
      keys.add(
        jedsPickKey({
          kind: pick.kind,
          movieId: pick.movieId,
          workId: pick.workId,
          catalogId: pick.catalogId,
        }),
      );
    }
    return keys;
  }, [picks]);

  const value = useMemo<JedsPicksContextValue>(
    () => ({
      canManage,
      isPicked: (item) => pickedKeys.has(jedsPickKey(item)),
      togglePick: async (item: JedsPickIdentity) => {
        try {
          const result = await toggle(item);
          toast.success(
            result.saved ? "Added to Jed's Picks" : "Removed from Jed's Picks",
          );
        } catch (error: unknown) {
          console.error(error);
          toast.error("Could not update Jed's Picks");
        }
      },
    }),
    [canManage, pickedKeys, toggle],
  );

  return (
    <JedsPicksContext.Provider value={value}>{children}</JedsPicksContext.Provider>
  );
}
