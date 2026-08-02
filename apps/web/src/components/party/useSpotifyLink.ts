import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@convex/_generated/api";

export type SpotifyLinkResult = { status: "linked" | "error"; message: string } | null;

/**
 * Reads the `?spotify=` params the Convex OAuth callback redirects back with,
 * then strips them so a refresh does not replay the banner.
 */
function readLinkResult(): SpotifyLinkResult {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const status = params.get("spotify");
  if (status !== "linked" && status !== "error") {
    return null;
  }
  const message =
    params.get("spotifyMessage") ??
    (status === "linked" ? "Spotify account connected." : "Could not connect Spotify.");

  params.delete("spotify");
  params.delete("spotifyMessage");
  const query = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );

  return { status, message };
}

export function useSpotifyLink() {
  const account = useQuery(api.spotify.getMyAccount);
  const configured = useQuery(api.spotify.isConfigured);
  const startLink = useAction(api.spotify.startLink);
  const unlink = useMutation(api.spotify.unlink);

  const [linkResult, setLinkResult] = useState<SpotifyLinkResult>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLinkResult(readLinkResult());
  }, []);

  const connect = useCallback(
    async (redirectPath?: string) => {
      setConnecting(true);
      setError(null);
      try {
        const url = await startLink({
          redirectPath: redirectPath ?? window.location.pathname,
        });
        window.location.href = url;
      } catch (caught) {
        setConnecting(false);
        setError(caught instanceof Error ? caught.message : "Could not start Spotify sign-in");
      }
    },
    [startLink],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await unlink();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect Spotify");
    }
  }, [unlink]);

  return {
    account: account ?? null,
    loading: account === undefined,
    configured: configured !== false,
    connecting,
    error,
    linkResult,
    dismissLinkResult: useCallback(() => setLinkResult(null), []),
    connect,
    disconnect,
  };
}
