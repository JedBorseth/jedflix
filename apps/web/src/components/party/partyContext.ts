import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, type Context } from "react";
import type { api } from "@convex/_generated/api";

export type PartyState = NonNullable<FunctionReturnType<typeof api.party.getState>>;
export type PartyMember = PartyState["members"][number];
export type PartySpotifyTarget = PartyState["spotifyTargets"][number];

export type PartyContextValue = {
  clientId: string;
  party: PartyState | null;
  loading: boolean;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  createParty: () => Promise<string>;
  joinParty: (code: string) => Promise<string>;
  leaveParty: () => Promise<void>;
};

// Survive Vite HMR — createContext() on every hot reload otherwise breaks
// Provider identity, the same way MusicPlayerContext handles it.
const PARTY_CONTEXT_KEY = "__jedflixPartyContext__";
type PartyGlobal = typeof globalThis & {
  [PARTY_CONTEXT_KEY]?: Context<PartyContextValue | null>;
};
const partyGlobal = globalThis as PartyGlobal;

export const PartyContext =
  partyGlobal[PARTY_CONTEXT_KEY] ??
  (partyGlobal[PARTY_CONTEXT_KEY] = createContext<PartyContextValue | null>(null));

export function useParty(): PartyContextValue {
  const value = useContext(PartyContext);
  if (!value) {
    throw new Error("useParty must be used within PartyProvider");
  }
  return value;
}

export function useOptionalParty(): PartyContextValue | null {
  return useContext(PartyContext);
}
