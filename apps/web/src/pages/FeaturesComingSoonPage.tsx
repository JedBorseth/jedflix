import { AppLink } from "@/components/layout/AppLink";

const UPCOMING_FEATURES = [
  "Better home page data",
  "Improved searching UI",
  "Full Spotify bidirectional sync",
  "And more",
] as const;

export function FeaturesComingSoonPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto flex max-w-3xl flex-col px-4 pb-36 md:px-12 md:pb-32">
        <AppLink
          to="/music"
          className="mb-6 w-fit text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back to music
        </AppLink>
        <h1 className="text-3xl font-bold tracking-tight">Coming soon</h1>
        <p className="mt-3 text-zinc-400">
          Features currently being worked on for JedFlix.
        </p>
        <ul className="mt-8 list-disc space-y-3 pl-5 text-zinc-200">
          {UPCOMING_FEATURES.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </main>
    </div>
  );
}
