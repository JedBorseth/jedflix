import { useConvexAuth, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";

/**
 * Like a track (idempotent). Shows toast; prompts sign-in when anonymous.
 */
export function useLikeTrack() {
  const { isAuthenticated } = useConvexAuth();
  const likeSong = useMutation(api.likedSongs.like);

  return async function likeTrack(track: MusicQueueTrack): Promise<boolean> {
    if (!isAuthenticated) {
      toast.error("Sign in to like songs", {
        action: {
          label: "Sign in",
          onClick: () => {
            window.location.assign("/sign-in");
          },
        },
      });
      return false;
    }

    try {
      await likeSong({
        track: {
          id: track.id,
          title: track.title,
          artists: track.artists,
          artistIds: track.artistIds,
          albumName: track.albumName,
          albumId: track.albumId,
          imageUrl: track.imageUrl,
          durationMs: track.durationMs,
        },
      });
      toast.success("Added to Liked Songs");
      return true;
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not like song",
      );
      return false;
    }
  };
}
