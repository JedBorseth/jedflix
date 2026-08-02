import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useParty } from "@/components/party/partyContext";
import { PartySpotifyControls } from "@/components/party/PartySpotifyControls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Matches MEMBER_ONLINE_WINDOW_MS in convex/partyModel.ts. */
const ONLINE_WINDOW_MS = 45_000;

export function PartyPanel() {
  const { isAuthenticated } = useConvexAuth();
  const { clientId, party, panelOpen, setPanelOpen, createParty, joinParty, leaveParty } =
    useParty();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!party) {
      return;
    }
    void navigator.clipboard?.writeText(party.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-white">
        <DialogHeader>
          <DialogTitle>Party mode</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Keep playback in step across JedFlix devices. Follow Spotify for track and
            position; pause/play syncs both ways.
          </DialogDescription>
        </DialogHeader>

        {!isAuthenticated ? (
          <p className="text-sm text-zinc-400">
            <Link className="text-white underline" to="/sign-in">
              Sign in
            </Link>{" "}
            to start or join a party.
          </p>
        ) : party ? (
          <div className="space-y-6">
            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Party code
              </p>
              <div className="flex items-center gap-3">
                <span className="font-mono text-3xl tracking-[0.35em] text-white">
                  {party.code}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={copyCode}
                  aria-label="Copy party code"
                >
                  {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                Share this code so other devices can join.
              </p>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                In this party ({party.members.length})
              </p>
              <ul className="space-y-2">
                {party.members.map((member) => (
                  <li
                    key={member._id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                  >
                    <span
                      className={
                        Date.now() - member.lastSeenAt < ONLINE_WINDOW_MS
                          ? "h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                          : "h-2 w-2 shrink-0 rounded-full bg-zinc-600"
                      }
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">
                        {member.deviceLabel}
                        {member.isSelf ? (
                          <span className="ml-2 text-xs text-zinc-500">this device</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {member.userName}
                        {member.isHost ? " · host" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Spotify
              </p>
              <PartySpotifyControls party={party} clientId={clientId} />
            </section>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void run(leaveParty)}
            >
              Leave party
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => setCode(await createParty()))}
              >
                Start a party
              </Button>
              <p className="text-xs text-zinc-500">
                You get a code other devices can use to join.
              </p>
            </section>

            <section className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="party-code">
                Join with a code
              </label>
              <div className="flex gap-2">
                <Input
                  id="party-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={6}
                  className="border-zinc-700 bg-zinc-950 font-mono tracking-[0.3em] text-white placeholder:text-zinc-600"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || code.trim().length === 0}
                  onClick={() => void run(() => joinParty(code))}
                >
                  Join
                </Button>
              </div>
            </section>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
