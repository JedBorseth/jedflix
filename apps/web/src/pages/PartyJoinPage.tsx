import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { partyErrorMessage } from "@/lib/partyClient";
import { useParty } from "@/components/party/partyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PartyJoinPage() {
  const { code: linkCode } = useParams();
  const navigate = useNavigate();
  const { joinParty, loading, party } = useParty();
  const [code, setCode] = useState(linkCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedCode = useRef<string | null>(null);
  const joinRef = useRef(joinParty);
  joinRef.current = joinParty;

  async function join(codeToJoin: string) {
    setBusy(true);
    setError(null);
    try {
      await joinRef.current(codeToJoin);
      void navigate("/music", { replace: true });
    } catch (caught) {
      setError(partyErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!linkCode || loading || attemptedCode.current === linkCode) return;
    attemptedCode.current = linkCode;
    void join(linkCode);
    // Only the invite and auth readiness should initiate an automatic join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode, loading]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-zinc-950 px-6 py-12 text-white">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-2xl font-black tracking-tight text-red-500">
          JedFlix
        </p>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Join the music</h1>
          <p className="text-sm text-zinc-400">
            Listen together, browse music, and share the controls. No account or
            setup needed.
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void join(code);
          }}
        >
          <label className="block space-y-2" htmlFor="join-party-code">
            <span className="text-sm text-zinc-300">Party code</span>
            <Input
              id="join-party-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC234"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              className="h-12 font-mono text-base uppercase tracking-[0.3em]"
              disabled={busy}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <Button
            className="h-12 w-full"
            disabled={busy || loading || code.trim().length !== 6}
          >
            {busy || loading ? "Joining party…" : "Join party"}
          </Button>
        </form>
        {party ? (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void navigate("/music")}
          >
            Return to party {party.code}
          </Button>
        ) : null}
        <Link
          to="/onboarding"
          className="block text-center text-sm text-zinc-500 hover:text-white"
        >
          Set up JedFlix instead
        </Link>
      </div>
    </main>
  );
}
