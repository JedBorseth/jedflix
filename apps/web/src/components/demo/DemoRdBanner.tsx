import { useLocation } from "react-router-dom";
import { REAL_DEBRID_AFFILIATE_URL } from "@/lib/demoRealDebrid";
import { cn } from "@/lib/utils";

type DemoRdBannerProps = {
  remaining?: number;
  playLimit?: number;
};

export function DemoRdBanner({ remaining, playLimit }: DemoRdBannerProps) {
  const { pathname } = useLocation();
  const belowNavbar =
    pathname !== "/onboarding" &&
    !pathname.startsWith("/watch") &&
    !pathname.startsWith("/listen") &&
    !pathname.startsWith("/read");

  return (
    <div
      role="status"
      data-testid="demo-rd-banner"
      className={cn(
        "fixed inset-x-0 z-40 border-b border-amber-700/30 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-zinc-950 md:px-12",
        belowNavbar ? "top-[var(--navbar-chrome-offset)]" : "top-0",
      )}
    >
      <span>
        You&apos;re in demo mode
        {typeof remaining === "number" && typeof playLimit === "number"
          ? ` (${remaining} of ${playLimit} plays left)`
          : ""}
        . Buy Real Debrid to keep watching movies, shows, and audiobooks.
      </span>{" "}
      <a
        href={REAL_DEBRID_AFFILIATE_URL}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-zinc-950/40 underline-offset-2 hover:decoration-zinc-950"
      >
        Get Real Debrid
      </a>
    </div>
  );
}
