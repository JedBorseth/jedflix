import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function SettingsPage() {
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
                This is placeholder UI. The stream server currently reads the token from
                REALDEBRID_TOKEN.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium text-zinc-200" htmlFor="real-debrid-token">
                API key
              </label>
              <Input
                id="real-debrid-token"
                type="password"
                disabled
                placeholder="••••••••••••••••"
                className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-600"
              />
              <p className="text-sm text-zinc-500">
                Saving API keys from the browser is not implemented yet.
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/60 text-white">
            <CardHeader>
              <CardTitle>Reset App</CardTitle>
              <CardDescription className="text-zinc-400">
                Clear local preferences and cached app state. This control is not wired up yet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" disabled>
                Reset app
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
