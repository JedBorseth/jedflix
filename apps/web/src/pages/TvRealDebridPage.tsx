import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REAL_DEBRID_API_KEY_URL,
  fetchTvRdKeyStatus,
  isValidTvRdCode,
  submitTvRdKey,
  type TvRdKeyStatus,
} from "@/lib/tvRdKey";

type PageState = "loading" | TvRdKeyStatus | "success";

export function TvRealDebridPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      if (!isValidTvRdCode(code)) {
        setPageState("missing");
        return;
      }
      try {
        const status = await fetchTvRdKeyStatus(code);
        if (!cancelled) {
          setPageState(status);
        }
      } catch {
        if (!cancelled) {
          setError("Could not reach the TV pairing service.");
          setPageState("missing");
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError("Paste your Real Debrid API key.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitTvRdKey(code, trimmed);
      setApiKey("");
      setPageState("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the API key.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-white">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-red-400">JedFlix TV</p>
          <h1 className="mt-1 text-3xl font-bold">Real Debrid API key</h1>
          <p className="mt-2 text-zinc-400">
            This key is sent only to the TV that showed the QR code. It is not saved in your JedFlix
            web account.
          </p>
        </div>

        {pageState === "loading" ? (
          <p className="text-zinc-400">Checking this code…</p>
        ) : null}

        {pageState === "missing" ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-zinc-300">
            This code is invalid or expired. Go back to the TV and scan a new QR code.
          </p>
        ) : null}

        {pageState === "submitted" ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-zinc-300">
            This TV already received a key. You can go back to the TV.
          </p>
        ) : null}

        {pageState === "success" ? (
          <p className="rounded-md border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-emerald-300">
            Key sent. You can go back to the TV.
          </p>
        ) : null}

        {pageState === "pending" ? (
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-200" htmlFor="tv-real-debrid-key">
                API key
              </label>
              <Input
                id="tv-real-debrid-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Paste your Real Debrid API key"
                className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-600"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Sending…" : "Send to TV"}
            </Button>
            <p className="text-sm text-zinc-500">
              Get your key from{" "}
              <a
                className="text-red-400 underline underline-offset-2"
                href={REAL_DEBRID_API_KEY_URL}
                target="_blank"
                rel="noreferrer"
              >
                real-debrid.com/apitoken
              </a>
              .
            </p>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </form>
        ) : null}

        {error && pageState !== "pending" ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
