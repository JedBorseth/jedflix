import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import { useConvexAuth } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { partyErrorMessage, partyJoinPath } from "@/lib/partyClient";
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
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const {
    clientId,
    party,
    panelOpen,
    setPanelOpen,
    createParty,
    joinParty,
    leaveParty,
  } = useParty();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const joinUrl = party
    ? new URL(partyJoinPath(party.code), window.location.origin).href
    : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setError("Couldn't copy the link. Select and copy the link below.");
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(partyErrorMessage(caught));
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
          <DialogTitle>
            {showQr && party?.isHost ? "Join this party" : "Party mode"}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {showQr && party?.isHost
              ? "Scan to join instantly. No account or setup needed."
              : "Keep playback in step across JedFlix devices. Follow Spotify for track and position; pause/play syncs both ways."}
          </DialogDescription>
        </DialogHeader>

        {party && showQr && party.isHost ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-fit max-w-full rounded-xl bg-white p-4">
              <QRCodeSVG
                value={joinUrl}
                size={280}
                marginSize={4}
                title="Scan to join this music party"
                className="h-auto max-w-full"
              />
            </div>
            <p className="font-mono text-2xl tracking-[0.3em]">{party.code}</p>
            <a
              href={joinUrl}
              className="block break-all text-xs text-zinc-400 underline"
            >
              {joinUrl}
            </a>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => void copyLink()}>
                {linkCopied ? "Link copied" : "Copy join link"}
              </Button>
              <Button variant="secondary" onClick={() => setShowQr(false)}>
                Back to party
              </Button>
            </div>
          </div>
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
                  {copied ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <CopyIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                Share this code so other devices can join without signing in.
              </p>
            </section>

            {party.isHost ? (
              <section className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowQr((open) => !open)}
                    aria-expanded={showQr}
                  >
                    {showQr ? "Hide QR code" : "Show QR code"}
                  </Button>
                  <Button variant="outline" onClick={() => void copyLink()}>
                    {linkCopied ? "Link copied" : "Copy join link"}
                  </Button>
                </div>
                <a
                  href={joinUrl}
                  className="block break-all text-xs text-zinc-400 underline"
                >
                  {joinUrl}
                </a>
                <p className="text-xs text-zinc-500">
                  Anyone with the code or link can join and control playback.
                </p>
              </section>
            ) : null}

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
                          <span className="ml-2 text-xs text-zinc-500">
                            this device
                          </span>
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

            {isAuthenticated ? (
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Spotify
                </p>
                <PartySpotifyControls party={party} clientId={clientId} />
              </section>
            ) : null}

            {party.isHost ? (
              <p className="text-xs text-zinc-500">
                Ending the party stops playback for everyone. If you disconnect,
                the party ends after 5 minutes offline.
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void run(leaveParty)}
            >
              {party.isHost ? "End party for everyone" : "Leave party"}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              {isAuthenticated ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => setCode(await createParty()))
                  }
                >
                  Start a party
                </Button>
              ) : (
                <p className="text-sm text-zinc-400">
                  <Link to="/sign-in" className="text-white underline">
                    Sign in
                  </Link>{" "}
                  to host a party. You can join without an account.
                </p>
              )}
              <p className="text-xs text-zinc-500">
                You get a code other devices can use to join.
              </p>
            </section>

            <section className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wide text-zinc-500"
                htmlFor="party-code"
              >
                Join with a code
              </label>
              <div className="flex gap-2">
                <Input
                  id="party-code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={6}
                  className="border-zinc-700 bg-zinc-950 font-mono text-base tracking-[0.3em] text-white placeholder:text-zinc-600"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || code.trim().length === 0}
                  onClick={() =>
                    void run(async () => {
                      await joinParty(code);
                      setPanelOpen(false);
                      void navigate("/music");
                    })
                  }
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
