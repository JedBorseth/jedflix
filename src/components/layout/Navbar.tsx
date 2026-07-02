import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";

export function Navbar() {
  const user = useQuery(api.users.viewer);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setIsSearchOpen(true);
      return;
    }

    navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`);
  }

  return (
    <header className="fixed top-0 z-50 w-full bg-gradient-to-b from-black/80 to-transparent">
      <nav className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-4 md:px-12">
        <div className="flex items-center gap-6 md:gap-10">
          <Link to="/" className="text-2xl font-bold tracking-tight text-red-600">
            JedFlix
          </Link>
          <div className="hidden items-center gap-5 text-sm text-zinc-200 md:flex">
            <Link to="/" viewTransition className="transition hover:text-white">
              Home
            </Link>
            <Link to="/shows" viewTransition className="transition hover:text-white">
              Shows
            </Link>
            <Link to="/movies" viewTransition className="transition hover:text-white">
              Movies
            </Link>
            <Authenticated>
              <Link to="/my-list" viewTransition className="transition hover:text-white">
                My List
              </Link>
            </Authenticated>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <form onSubmit={handleSubmit} className="flex items-center justify-end">
            <div
              className={`flex items-center overflow-hidden rounded-md border border-transparent bg-black/40 transition-all duration-200 ${
                isSearchOpen
                  ? "w-44 border-zinc-700 px-2 md:w-72"
                  : "w-9 hover:border-zinc-700"
              }`}
            >
              <button
                type={isSearchOpen ? "submit" : "button"}
                className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-200 transition hover:text-white"
                aria-label={isSearchOpen ? "Search" : "Open search"}
                onClick={() => {
                  if (!isSearchOpen) {
                    setIsSearchOpen(true);
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
                  placeholder="Search titles"
                  className="h-9 border-0 bg-transparent px-1 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-0"
                />
              ) : null}
            </div>
          </form>
          <Authenticated>
            <UserMenu>{user?.name ?? user?.email ?? "Account"}</UserMenu>
          </Authenticated>
          <Unauthenticated>
            <Button asChild variant="outline" size="sm" className="border-zinc-600 bg-black/40">
              <Link to="/sign-in">Sign In</Link>
            </Button>
          </Unauthenticated>
        </div>
      </nav>
    </header>
  );
}
