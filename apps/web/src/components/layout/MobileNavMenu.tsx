import { useAuthActions } from "@convex-dev/auth/react";
import { GearIcon } from "@radix-ui/react-icons";
import { Authenticated, Unauthenticated } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppLink } from "@/components/layout/AppLink";
import { StreamModeControl } from "@/components/layout/StreamModeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const accountButtonClassName =
  "h-8 w-auto border-zinc-700 bg-zinc-900/80 px-3 text-zinc-100 hover:bg-zinc-800 hover:text-white";

function MenuLink({
  to,
  children,
  onClick,
}: {
  to: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <AppLink
      to={to}
      onClick={onClick}
      className="inline-flex rounded-md px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-900 hover:text-white"
    >
      {children}
    </AppLink>
  );
}

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
          aria-label={isOpen ? "Close menu" : "Open menu"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <GearIcon className="h-5 w-5" />
        </button>
      </div>

      <div
        className={cn(
          "absolute right-0 top-12 w-64 origin-top-right overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 text-sm text-zinc-200 shadow-2xl backdrop-blur-md transition-all duration-200",
          isOpen
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0",
        )}
      >
        <div className="space-y-4">
          <Authenticated>
            <div>
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Account
              </p>
              <div className="flex flex-col items-start gap-2">
                <MenuLink to="/my-list" onClick={closeMenu}>
                  My List
                </MenuLink>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className={accountButtonClassName}
                  onClick={closeMenu}
                >
                  <AppLink to="/settings">Settings</AppLink>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-auto w-auto px-3 py-2 text-zinc-200 hover:bg-zinc-900 hover:text-white"
                  onClick={() => {
                    closeMenu();
                    void signOut();
                  }}
                >
                  Sign out
                </Button>
              </div>
            </div>
          </Authenticated>

          <Unauthenticated>
            <div>
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Account
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className={accountButtonClassName}
                  onClick={closeMenu}
                >
                  <Link to="/sign-in">Sign in</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className={accountButtonClassName}
                  onClick={closeMenu}
                >
                  <Link to="/settings">Settings</Link>
                </Button>
              </div>
            </div>
          </Unauthenticated>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Stream type
            </p>
            <StreamModeControl className="justify-start border-zinc-700 bg-black/50" />
          </div>
        </div>
      </div>
    </div>
  );
}
