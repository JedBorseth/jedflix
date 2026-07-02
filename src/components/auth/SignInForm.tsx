import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Navbar } from "@/components/layout/Navbar";
import { Toaster, toast } from "sonner";

export function SignInForm() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 pb-16 pt-28">
        <h2 className="text-3xl font-bold">
          {flow === "signIn" ? "Sign In" : "Create Account"}
        </h2>
        <p className="text-zinc-400">
          Use email and password to save watch progress to your list.
        </p>

        <form
          className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitting(true);
            const formData = new FormData(event.currentTarget);
            formData.set("flow", flow);
            void signIn("password", formData)
              .then(() => {
                toast.success(flow === "signIn" ? "Signed in" : "Account created");
              })
              .catch((error: unknown) => {
                console.error(error);
                toast.error("Authentication failed");
              })
              .finally(() => setSubmitting(false));
          }}
        >
          <label htmlFor="email" className="text-sm text-zinc-300">
            Email
          </label>
          <Input
            name="email"
            id="email"
            type="email"
            autoComplete="email"
            required
            className="border-zinc-700 bg-zinc-950"
          />

          <label htmlFor="password" className="text-sm text-zinc-300">
            Password
          </label>
          <Input
            name="password"
            id="password"
            type="password"
            autoComplete={flow === "signIn" ? "current-password" : "new-password"}
            required
            minLength={8}
            className="border-zinc-700 bg-zinc-950"
          />

          <Button
            type="submit"
            disabled={submitting}
            className="bg-red-600 hover:bg-red-700"
          >
            {submitting
              ? "Please wait..."
              : flow === "signIn"
                ? "Sign In"
                : "Create Account"}
          </Button>
        </form>

        <Button
          variant="link"
          className="self-start p-0 text-zinc-400"
          onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
        >
          {flow === "signIn"
            ? "Need an account? Create one"
            : "Already have an account? Sign in"}
        </Button>

        <Button asChild variant="ghost" className="self-start text-zinc-400">
          <Link to="/">Continue browsing without signing in</Link>
        </Button>

        <Toaster />
      </div>
    </div>
  );
}
