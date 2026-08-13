import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

export type MusicInteractionKind =
  | "play"
  | "skip"
  | "complete"
  | "select"
  | "search"
  | "click";

export type MusicInteractionInput = {
  kind: MusicInteractionKind;
  trackId?: string;
  title?: string;
  artists?: string[];
  query?: string;
  resultId?: string;
  resultKind?: string;
};

export function useMusicInteractionLog() {
  const log = useMutation(api.musicInteractions.log);
  return useCallback(
    (event: MusicInteractionInput) => {
      void log(event).catch(() => {
        // Logging must never interrupt playback or search.
      });
    },
    [log],
  );
}
