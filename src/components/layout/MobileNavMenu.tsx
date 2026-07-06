import { useAuthActions } from "@convex-dev/auth/react";
import { GearIcon } from "@radix-ui/react-icons";
import { Authenticated, Unauthenticated } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { StreamModeControl } from "@/components/layout/StreamModeToggle";
import { cn } from "@/lib/utils";

export function MobileNavMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { signOut } = useAuthActions();

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative md:hidden">
      <div
        className={cn(
          "flex items-center overflow-hidden rounded-md border border-transparent bg-black/40 transition-all duration-200",
          isOpen ? "w-9 border-zinc-700" : "w-9 hover:border-zinc-700",
        )}
      >
        <button
          type="button"
          className="flex h-10 w-9 shrink-0 items-center justify-center text-zinc-200 transition hover:text-white"
          aria-label={isOpen ? "Close settings menu" : "Open settings menu"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <GearIcon className="h-5 w-5" />
        </button>
      </div>

      <div
        className={cn(
          "absolute right-0 top-12 w-72 origin-top-right overflow-hidden rounded-lg border border-zinc-800 bg-black/95 p-3 text-sm text-zinc-200 shadow-2xl transition-all duration-200",
          isOpen
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0",
        )}
      >
        <div className="space-y-3">
          <Unauthenticated>
            <Button
              asChild
              variant="outline"
              className="w-full justify-start border-zinc-700 bg-zinc-950/80 text-zinc-100 hover:bg-zinc-900 hover:text-white"
              onClick={closeMenu}
            >
              <Link to="/sign-in">Sign in</Link>
            </Button>
          </Unauthenticated>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Stream type
            </div>
            <StreamModeControl className="justify-start border-zinc-700 bg-black/50" />
          </div>

          <Button
            asChild
            variant="ghost"
            className="w-full justify-start text-zinc-200 hover:bg-zinc-900 hover:text-white"
            onClick={closeMenu}
          >
            <Link to="/settings">Settings</Link>
          </Button>

          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-zinc-300">Theme</span>
            <ThemeToggle />
          </div>

          <Authenticated>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start text-zinc-200 hover:bg-zinc-900 hover:text-white"
              onClick={() => {
                closeMenu();
                void signOut();
              }}
            >
              Sign out
            </Button>
          </Authenticated>
        </div>
      </div>
    </div>
  );
}
