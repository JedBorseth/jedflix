import { useSpotifyLink } from "@/components/party/useSpotifyLink";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SpotifyConnectCard() {
  const { account, loading, configured, connecting, error, linkResult, connect, disconnect } =
    useSpotifyLink();

  return (
    <Card className="border-zinc-800 bg-zinc-900/60 text-white">
      <CardHeader>
        <CardTitle>Spotify</CardTitle>
        <CardDescription className="text-zinc-400">
          Connect a Spotify account so party mode can follow what it is playing. JedFlix
          never changes Spotify playback — it only mirrors it. Tokens are stored on the
          backend and never sent to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured ? (
          <p className="text-sm text-zinc-500">
            Spotify is not configured on this server. Set SPOTIFY_CLIENT_ID and
            SPOTIFY_CLIENT_SECRET in the Convex deployment.
          </p>
        ) : loading ? (
          <p className="text-sm text-zinc-500">Checking connection…</p>
        ) : account ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{account.displayName}</p>
              <p className="text-xs text-zinc-500">
                {account.isPremium ? "Premium" : "Free account"} · read-only follow
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        ) : (
          <Button type="button" disabled={connecting} onClick={() => void connect("/settings")}>
            {connecting ? "Opening Spotify…" : "Connect Spotify"}
          </Button>
        )}

        {linkResult ? (
          <p
            className={
              linkResult.status === "linked"
                ? "text-sm text-emerald-400"
                : "text-sm text-red-400"
            }
          >
            {linkResult.message}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
