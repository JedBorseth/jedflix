import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  CONTENT_TYPE_OPTIONS,
  DEVICE_TYPE_OPTIONS,
  EXTERNAL_PLAYER_OPTIONS,
  toggleContentType,
} from "@/lib/settingsForm";
import type { DeviceType, ExternalPlayer } from "@/lib/userSettings";

export function SettingsPage() {
  const navigate = useNavigate();
  const {
    realDebridApiKey,
    externalPlayer,
    deviceType,
    contentTypes,
    letterboxdUsername,
    saveSettings,
    resetSettings,
    syncEnabled,
  } = useUserSettings();
  const [apiKey, setApiKey] = useState(realDebridApiKey);
  const [letterboxd, setLetterboxd] = useState(letterboxdUsername);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiKey(realDebridApiKey);
  }, [realDebridApiKey]);

  useEffect(() => {
    setLetterboxd(letterboxdUsername);
  }, [letterboxdUsername]);

  const handleSaveApiKey = () => {
    saveSettings({ realDebridApiKey: apiKey.trim() || undefined });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveLetterboxd = () => {
    saveSettings({ letterboxdUsername: letterboxd.trim() || undefined });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    resetSettings();
    void navigate("/onboarding", { replace: true });
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
              <CardTitle>Device type</CardTitle>
              <CardDescription className="text-zinc-400">
                Stored preference for this device. Playback behavior can use this later.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={deviceType}
                onValueChange={(value) => {
                  saveSettings({ deviceType: value as DeviceType });
                }}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue placeholder="Select device type" />
                </SelectTrigger>
                <SelectContent>
                  {DEVICE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Content</CardTitle>
              <CardDescription className="text-zinc-400">
                Choose which library tabs appear in navigation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {CONTENT_TYPE_OPTIONS.map((option) => {
                const checked = contentTypes.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-red-500"
                      checked={checked}
                      onChange={(event) => {
                        const next = toggleContentType(
                          contentTypes,
                          option.value,
                          event.target.checked,
                        );
                        if (next.length === 0) {
                          return;
                        }
                        saveSettings({ contentTypes: next });
                      }}
                    />
                    {option.label}
                  </label>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Real Debrid API Key</CardTitle>
              <CardDescription className="text-zinc-400">
                Required for direct Real Debrid streaming from your browser.
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
                  {EXTERNAL_PLAYER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-zinc-500">
                Built-in playback uses direct Real Debrid links. Prefer VLC or OutPlayer for MKV /
                Atmos releases that browsers cannot decode.
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Letterboxd</CardTitle>
              <CardDescription className="text-zinc-400">
                Optional username for future Letterboxd integrations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium text-zinc-200" htmlFor="letterboxd-username">
                Username
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="letterboxd-username"
                  type="text"
                  value={letterboxd}
                  onChange={(event) => setLetterboxd(event.target.value)}
                  onBlur={handleSaveLetterboxd}
                  placeholder="your-username"
                  className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-600"
                />
                <Button type="button" onClick={handleSaveLetterboxd}>
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Reset App</CardTitle>
              <CardDescription className="text-zinc-400">
                Clear local settings and account-synced settings. Watch history and your list are
                kept. You will need to complete onboarding again.
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
                      This clears your Real Debrid API key, device and content preferences, player
                      settings, and Letterboxd username from this browser and from your account if
                      you are signed in. Onboarding will start again.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="destructive" onClick={handleReset}>
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
