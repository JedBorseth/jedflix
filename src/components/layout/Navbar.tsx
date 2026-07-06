import { FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppLink } from "@/components/layout/AppLink";
import { MobileNavMenu } from "@/components/layout/MobileNavMenu";
import { StreamModeToggle } from "@/components/layout/StreamModeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MagnifyingGlassIcon, GearIcon } from "@radix-ui/react-icons";

export function Navbar() {
  const user = useQuery(api.users.viewer);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function openSearch() {
    setIsSearchOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      openSearch();
      return;
    }

    void navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`);
  }

  return (
    <header className="fixed top-0 z-50 w-full bg-gradient-to-b from-black/80 to-transparent pt-[env(safe-area-inset-top)]">
      <nav className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-4 md:px-12">
        <div className="flex items-center gap-6 md:gap-10">
          <StreamModeToggle />
          <Link to="/" className="text-2xl font-bold tracking-tight text-red-600">
            JedFlix
          </Link>
          <div className="hidden items-center gap-5 text-sm text-zinc-200 md:flex">
            <AppLink to="/" className="transition hover:text-white">
              Home
            </AppLink>
            <AppLink to="/shows" className="transition hover:text-white">
              Shows
            </AppLink>
            <AppLink to="/movies" className="transition hover:text-white">
              Movies
            </AppLink>
            <Authenticated>
              <AppLink to="/my-list" className="transition hover:text-white">
                My List
              </AppLink>
            </Authenticated>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <form onSubmit={handleSubmit} className="flex items-center justify-end">
            <div
              className={`flex items-center overflow-hidden rounded-md border border-transparent bg-black/40 transition-all duration-200 ${
                isSearchOpen
                  ? "w-52 border-zinc-700 px-2 md:w-72"
                  : "w-9 hover:border-zinc-700"
              }`}
            >
              <button
                type={isSearchOpen ? "submit" : "button"}
                className="flex h-10 w-9 shrink-0 items-center justify-center text-zinc-200 transition hover:text-white md:h-9"
                aria-label={isSearchOpen ? "Search" : "Open search"}
                onClick={() => {
                  if (!isSearchOpen) {
                    openSearch();
                  }
                }}
              >
                <MagnifyingGlassIcon className="h-5 w-5" />
              </button>
              {isSearchOpen ? (
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onBlur={() => {
                    if (!query.trim()) {
                      setIsSearchOpen(false);
                    }
                  }}
                  placeholder="Search movies, shows, or cast"
                  className="h-10 border-0 bg-transparent px-1 text-base text-white placeholder:text-zinc-500 focus-visible:ring-0 md:h-9 md:text-sm"
                />
              ) : null}
            </div>
          </form>
          <MobileNavMenu />
          <div className="hidden items-center gap-3 md:flex">
            <Unauthenticated>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="border-zinc-600 bg-black/40"
              >
                <Link to="/sign-in">Sign In</Link>
              </Button>
            </Unauthenticated>
            <Button
              asChild
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 border-zinc-600 bg-black/40 text-zinc-200 hover:bg-zinc-900 hover:text-white"
            >
              <AppLink to="/settings" aria-label="Settings">
                <GearIcon className="h-5 w-5" />
              </AppLink>
            </Button>
            <Authenticated>
              <UserMenu>{user?.name ?? user?.email ?? "Account"}</UserMenu>
            </Authenticated>
          </div>
        </div>
      </nav>
    </header>
  );
}
