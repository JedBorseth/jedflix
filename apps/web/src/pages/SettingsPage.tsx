import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useOptionalParty } from "@/components/party/partyContext";
import { SpotifyConnectCard } from "@/components/party/SpotifyConnectCard";
import { useUserSettings } from "@/hooks/useUserSettings";
import { validateLetterboxdUsername } from "@/lib/letterboxd";
import {
  CONTENT_TYPE_OPTIONS,
  DEVICE_TYPE_OPTIONS,
  EXTERNAL_PLAYER_OPTIONS,
  isContentTypeLockedWithoutDebrid,
  toggleContentType,
} from "@/lib/settingsForm";
import type { DeviceType, ExternalPlayer } from "@/lib/userSettings";
import { withoutDebridContentTypes } from "@/lib/userSettings";

export function SettingsPage() {
  const navigate = useNavigate();
  const party = useOptionalParty();
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
  const [letterboxdError, setLetterboxdError] = useState<string | null>(null);
  const [letterboxdSuccess, setLetterboxdSuccess] = useState<string | null>(null);
  const [isVerifyingLetterboxd, setIsVerifyingLetterboxd] = useState(false);

  useEffect(() => {
    setApiKey(realDebridApiKey);
  }, [realDebridApiKey]);

  useEffect(() => {
    setLetterboxd(letterboxdUsername);
  }, [letterboxdUsername]);

  const handleSaveApiKey = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      const nextTypes = withoutDebridContentTypes(contentTypes);
      saveSettings({
        realDebridApiKey: undefined,
        contentTypes: nextTypes.length > 0 ? nextTypes : ["music"],
      });
    } else {
      saveSettings({ realDebridApiKey: trimmed });
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveLetterboxd = async () => {
    const raw = letterboxd.trim();
    setLetterboxdError(null);
    setLetterboxdSuccess(null);

    if (!raw) {
      saveSettings({ letterboxdUsername: undefined });
      setLetterboxd("");
      setLetterboxdSuccess("Letterboxd username cleared.");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      return;
    }

    setIsVerifyingLetterboxd(true);
    const verified = await validateLetterboxdUsername(raw);
    setIsVerifyingLetterboxd(false);

    if (verified.error) {
      setLetterboxdError(verified.error);
      return;
    }

    const username = verified.username ?? raw.toLowerCase();
    setLetterboxd(username);
    saveSettings({ letterboxdUsername: username });
    const count = verified.result?.filmCount ?? 0;
    setLetterboxdSuccess(
      `Connected @${username} — ${count} recent diary film${count === 1 ? "" : "s"} found.`,
    );
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    resetSettings();
    void navigate("/onboarding", { replace: true });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
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
                Automatically filters streams for compatibility based on your device
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
              {!realDebridApiKey.trim() ? (
                <p className="mb-2 text-sm text-amber-200/90">
                  Movies, shows, audiobooks, and games need a Real Debrid API key below.
                </p>
              ) : null}
              {CONTENT_TYPE_OPTIONS.map((option) => {
                const checked = contentTypes.includes(option.value);
                const locked = isContentTypeLockedWithoutDebrid(option.value, realDebridApiKey);
                return (
                  <label
                    key={option.value}
                    className={`flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm ${
                      locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-red-500 disabled:cursor-not-allowed"
                      checked={checked}
                      disabled={locked}
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
                    <span>
                      {option.label}
                      {locked ? (
                        <span className="mt-0.5 block text-xs text-zinc-500">Needs Real Debrid</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Real Debrid API Key</CardTitle>
              <CardDescription className="text-zinc-400">
                Required for movies, shows, audiobooks, and games. Music works without a key.
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
                The default video player for streaming movies and shows on our platform. Either play
                in browser or choose a program to open when clicking on a stream.
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
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Letterboxd</CardTitle>
              <CardDescription className="text-zinc-400">
                Public username used to personalize your home feed with recent diary watches.
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
                  onChange={(event) => {
                    setLetterboxd(event.target.value);
                    setLetterboxdError(null);
                    setLetterboxdSuccess(null);
                  }}
                  placeholder="your-username"
                  className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-600"
                />
                <Button
                  type="button"
                  disabled={isVerifyingLetterboxd}
                  onClick={() => void handleSaveLetterboxd()}
                >
                  {isVerifyingLetterboxd ? "Checking..." : "Save"}
                </Button>
              </div>
              {letterboxdError ? <p className="text-sm text-red-400">{letterboxdError}</p> : null}
              {letterboxdSuccess ? (
                <p className="text-sm text-emerald-400">{letterboxdSuccess}</p>
              ) : null}
            </CardContent>
          </Card>

          <SpotifyConnectCard />

          {party ? (
            <Card className="border-zinc-800 bg-zinc-900/60 text-white">
              <CardHeader>
                <CardTitle>Party mode</CardTitle>
                <CardDescription className="text-zinc-400">
                  Sync music playback across JedFlix devices. Optionally follow Spotify for
                  track and position; pause and play sync both ways.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {party.party ? (
                  <p className="text-sm text-zinc-300">
                    In party{" "}
                    <span className="font-mono tracking-[0.2em] text-white">
                      {party.party.code}
                    </span>{" "}
                    with {party.party.members.length} device
                    {party.party.members.length === 1 ? "" : "s"}.
                  </p>
                ) : null}
                <Button type="button" onClick={() => party.setPanelOpen(true)}>
                  {party.party ? "Manage party" : "Start or join a party"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

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
