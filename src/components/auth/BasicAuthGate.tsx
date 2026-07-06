import {
  clearBasicAuthCredentials,
  getBasicAuthCredentials,
  saveBasicAuthCredentials,
  syncBasicAuthToIndexedDB,
  BASIC_AUTH_REQUIRED_EVENT,
  type BasicAuthCredentials,
} from "@/lib/basicAuth";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GateState = "checking" | "ready" | "login";

async function validateBasicAuth(): Promise<boolean> {
  const response = await authenticatedFetch("/favicon.ico", { method: "HEAD" });
  if (response.status === 401) {
    return false;
  }
  return response.ok || response.status === 404;
}

async function checkAuthRequired(): Promise<boolean> {
  const response = await authenticatedFetch("/favicon.ico", { method: "HEAD" });
  if (response.status === 401) {
    return true;
  }
  return false;
}

export function BasicAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const runCheck = useCallback(async () => {
    setState("checking");
    setError(null);

    const credentials = getBasicAuthCredentials();
    if (credentials) {
      await syncBasicAuthToIndexedDB();
    }

    const authRequired = await checkAuthRequired();
    if (!authRequired) {
      setState("ready");
      return;
    }

    if (credentials) {
      const valid = await validateBasicAuth();
      if (valid) {
        setState("ready");
        return;
      }
      clearBasicAuthCredentials();
    }

    setState("login");
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  useEffect(() => {
    const handler = () => {
      setState("login");
      setError("Session expired. Please sign in again.");
    };
    window.addEventListener(BASIC_AUTH_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(BASIC_AUTH_REQUIRED_EVENT, handler);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const credentials: BasicAuthCredentials = {
      username: username.trim(),
      password,
    };

    if (!credentials.username || !credentials.password) {
      setError("Username and password are required.");
      setSubmitting(false);
      return;
    }

    await saveBasicAuthCredentials(credentials);
    const valid = await validateBasicAuth();
    setSubmitting(false);

    if (!valid) {
      clearBasicAuthCredentials();
      setError("Invalid username or password.");
      return;
    }

    setState("ready");
  };

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        Loading...
      </div>
    );
  }

  if (state === "login") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4">
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-6"
        >
          <div>
            <h1 className="text-xl font-semibold text-white">Sign in to JedFlix</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Enter your site credentials. They are saved on this device.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-zinc-300" htmlFor="basic-auth-username">
              Username
            </label>
            <Input
              id="basic-auth-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="border-zinc-700 bg-zinc-900 text-white"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-zinc-300" htmlFor="basic-auth-password">
              Password
            </label>
            <Input
              id="basic-auth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="border-zinc-700 bg-zinc-900 text-white"
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    );
  }

  return children;
}
