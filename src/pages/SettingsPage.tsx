import { useEffect, useState } from "react";
import { StreamModeControl } from "@/components/layout/StreamModeToggle";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserSettings } from "@/hooks/useUserSettings";
import type { ExternalPlayer } from "@/lib/userSettings";

export function SettingsPage() {
  const { realDebridApiKey, externalPlayer, saveSettings, resetSettings, syncEnabled } =
    useUserSettings();
  const [apiKey, setApiKey] = useState(realDebridApiKey);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiKey(realDebridApiKey);
  }, [realDebridApiKey]);

  const handleSaveApiKey = () => {
    saveSettings({ realDebridApiKey: apiKey.trim() || undefined });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="pt-navbar mx-auto max-w-4xl px-4 pb-28 md:px-12 md:pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="mt-2 text-zinc-400">
            Manage app preferences and streaming configuration.
          </p>
        </div>

        <div className="space-y-6">
          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Real Debrid API Key</CardTitle>
              <CardDescription className="text-zinc-400">
                Direct streaming uses this key from your browser. Proxy streaming uses it when
                present, then falls back to the server REALDEBRID_TOKEN.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="text-sm font-medium text-zinc-200" htmlFor="real-debrid-token">
                API key
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="real-debrid-token"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  onBlur={handleSaveApiKey}
                  placeholder="Paste your Real Debrid API key"
                  className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-600"
                />
                <Button type="button" onClick={handleSaveApiKey}>
                  Save
                </Button>
              </div>
              <p className="text-sm text-zinc-500">
                Real Debrid keys stored in the browser are visible in DevTools.{" "}
                {syncEnabled
                  ? "Settings sync to your account."
                  : "Sign in to sync settings to your account."}
              </p>
              {saved ? <p className="text-sm text-emerald-400">Settings saved.</p> : null}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Stream Mode</CardTitle>
              <CardDescription className="text-zinc-400">
                Direct streams resolve with your browser and Real Debrid API key. Proxy streams use
                the stream server for resolving and byte serving.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StreamModeControl className="inline-flex" itemClassName="h-9 px-4 text-sm" />
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Video Player</CardTitle>
              <CardDescription className="text-zinc-400">
                Disabled uses the built-in player (Stremio on desktop, native video on mobile).
                External players open the stream in VLC or OutPlayer instead.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium text-zinc-200" htmlFor="external-player">
                External player
              </label>
              <Select
                value={externalPlayer}
                onValueChange={(value) => {
                  saveSettings({ externalPlayer: value as ExternalPlayer });
                }}
              >
                <SelectTrigger id="external-player" className="max-w-xs">
                  <SelectValue placeholder="Disabled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="vlc">VLC</SelectItem>
                  <SelectItem value="outplayer">OutPlayer</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-zinc-500">
                Proxy stream mode is recommended for in-app mobile playback.
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Reset App</CardTitle>
              <CardDescription className="text-zinc-400">
                Clear local settings and account-synced settings. Watch history and your list are
                kept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive">Reset app</Button>
                </DialogTrigger>
                <DialogContent className="border-zinc-800 bg-zinc-950 text-white">
                  <DialogHeader>
                    <DialogTitle>Reset app settings?</DialogTitle>
                    <DialogDescription className="text-zinc-400">
                      This clears your Real Debrid API key, stream mode, and external player
                      preference from this browser and from your account if you are signed in.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="destructive" onClick={resetSettings}>
                        Reset settings
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
