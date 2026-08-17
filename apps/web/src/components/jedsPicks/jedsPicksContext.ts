import { createContext, useContext } from "react";
import type { JedsPickIdentity } from "@/lib/jedsPicks";

export type JedsPicksContextValue = {
  canManage: boolean;
  isPicked: (item: JedsPickIdentity) => boolean;
  togglePick: (item: JedsPickIdentity) => Promise<void>;
};

export const JedsPicksContext = createContext<JedsPicksContextValue>({
  canManage: false,
  isPicked: () => false,
  togglePick: async () => {},
});

export function useJedsPicks() {
  return useContext(JedsPicksContext);
}
