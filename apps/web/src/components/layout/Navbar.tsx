import {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppLink } from "@/components/layout/AppLink";
import { MobileNavMenu } from "@/components/layout/MobileNavMenu";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Cross2Icon,
  GearIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { useUserSettings } from "@/hooks/useUserSettings";
import { cn } from "@/lib/utils";

export type SearchMode = "media" | "books" | "music";

/** Wait this long after typing before hitting remote search APIs. */
export const SEARCH_DEBOUNCE_MS = 500;

function isBooksPath(pathname: string, search: string): boolean {
  if (
    pathname.startsWith("/audiobooks") ||
    pathname.startsWith("/audiobook/") ||
    pathname.startsWith("/author/")
  ) {
    return true;
  }
  if (pathname.startsWith("/search")) {
    return new URLSearchParams(search).get("type") === "books";
  }
  return false;
}

function isMusicPath(pathname: string, search: string): boolean {
  if (
    pathname.startsWith("/music") ||
    pathname.startsWith("/album/") ||
    pathname.startsWith("/music-artist/")
  ) {
    return true;
  }
  if (pathname.startsWith("/search")) {
    return new URLSearchParams(search).get("type") === "music";
  }
  return false;
}

function buildSearchPath(query: string, mode: SearchMode): string {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) {
    params.set("q", trimmed);
  }
  if (mode === "books") {
    params.set("type", "books");
  } else if (mode === "music") {
    params.set("type", "music");
  }
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function readSearchQuery(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
}

export function Navbar() {
  const user = useQuery(api.users.viewer);
  const { contentTypes } = useUserSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchOriginRef = useRef("/");
  const isOnSearchPage = location.pathname.startsWith("/search");
  const [isSearchOpen, setIsSearchOpen] = useState(isOnSearchPage);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [query, setQuery] = useState(() =>
    isOnSearchPage ? readSearchQuery(location.search) : "",
  );
  const showMoviesShows = contentTypes.includes("movies_shows");
  const showAudiobooks = contentTypes.includes("audiobooks");
  const showMusic = contentTypes.includes("music");
  const showVideoGames = contentTypes.includes("video_games");
  const activeSearchMode: SearchMode = isMusicPath(
    location.pathname,
    location.search,
  )
    ? "music"
    : isBooksPath(location.pathname, location.search)
      ? "books"
      : "media";
  const searchPlaceholder =
    activeSearchMode === "books"
      ? "Search books or authors"
      : activeSearchMode === "music"
        ? "Search albums or artists"
        : "Search movies, shows, or cast";

  function rememberSearchOrigin(path = `${location.pathname}${location.search}`) {
    if (!path.startsWith("/search")) {
      searchOriginRef.current = path || "/";
    }
  }

  function defaultSearchOrigin(mode: SearchMode): string {
    if (mode === "books") {
      return "/audiobooks";
    }
    if (mode === "music") {
      return "/music";
    }
    return "/";
  }

  // Hydrate from the URL when a Did-you-mean chip (or back/forward) changes it.
  // While the input is focused, ignore stale debounce URL updates that are still
  // a prefix/extension of what the user is typing, but always adopt corrections
  // like "the offive" → "The Office".
  useEffect(() => {
    if (!isOnSearchPage) {
      return;
    }
    setIsSearchOpen(true);
    const urlQuery = readSearchQuery(location.search);
    setQuery((current) => {
      if (current === urlQuery) {
        return current;
      }
      if (document.activeElement === inputRef.current) {
        const typed = current.trim();
        const fromUrl = urlQuery.trim();
        if (
          typed.length > 0 &&
          fromUrl.length > 0 &&
          (typed.startsWith(fromUrl) || fromUrl.startsWith(typed))
        ) {
          return current;
        }
      }
      return urlQuery;
    });
  }, [isOnSearchPage, location.search]);

  // After expand, ensure focus lands on the already-mounted input.
  useLayoutEffect(() => {
    if (!isSearchOpen || !isSearchFocused) {
      return;
    }
    const input = inputRef.current;
    if (!input || document.activeElement === input) {
      return;
    }
    input.focus({ preventScroll: true });
    const length = input.value.length;
    input.setSelectionRange(length, length);
  }, [isSearchOpen, isSearchFocused]);

  // Debounced live search — Navbar stays mounted across routes, so this
  // update won't dismiss the iOS keyboard mid-typing.
  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const trimmed = query.trim();
    const timer = window.setTimeout(() => {
      const current = `${window.location.pathname}${window.location.search}`;
      const onSearch = window.location.pathname.startsWith("/search");

      if (!trimmed) {
        if (onSearch) {
          const emptyPath = buildSearchPath("", activeSearchMode);
          if (current !== emptyPath) {
            void navigate(emptyPath, { replace: true });
          }
        }
        return;
      }

      if (!onSearch) {
        searchOriginRef.current = current || "/";
      }

      const nextPath = buildSearchPath(trimmed, activeSearchMode);
      if (current === nextPath) {
        return;
      }
      void navigate(nextPath, { replace: onSearch });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, activeSearchMode, isSearchOpen, navigate]);

  function openSearch() {
    rememberSearchOrigin();
    setIsSearchOpen(true);
    setIsSearchFocused(true);
    // Focus synchronously inside the tap handler so iOS opens the keyboard
    // on the first press (input stays mounted even when collapsed).
    inputRef.current?.focus({ preventScroll: true });
  }

  function clearSearch() {
    setQuery("");
    setIsSearchOpen(true);
    setIsSearchFocused(true);
    inputRef.current?.focus({ preventScroll: true });
  }

  function cancelSearch() {
    inputRef.current?.blur();
    setIsSearchFocused(false);
    setIsSearchOpen(false);
    setQuery("");

    const origin = searchOriginRef.current.startsWith("/search")
      ? defaultSearchOrigin(activeSearchMode)
      : searchOriginRef.current || defaultSearchOrigin(activeSearchMode);

    if (isOnSearchPage) {
      void navigate(origin);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      openSearch();
      return;
    }

    const nextPath = buildSearchPath(trimmedQuery, activeSearchMode);
    const current = `${location.pathname}${location.search}`;
    if (current !== nextPath) {
      void navigate(nextPath, { replace: isOnSearchPage });
    }
  }

  return (
    <header className="fixed top-0 z-50 w-full bg-gradient-to-b from-black/80 to-transparent pt-[env(safe-area-inset-top)]">
      <nav
        className={cn(
          "mx-auto flex max-w-[1920px] items-center px-4 py-4 md:px-12",
          isSearchFocused ? "gap-3" : "justify-between gap-6",
        )}
      >
        {!isSearchFocused ? (
          <div className="flex min-w-0 items-center gap-6 md:gap-10">
            <Link
              to="/"
              className="shrink-0 text-2xl font-bold tracking-tight text-red-600"
            >
              JedFlix
            </Link>
            <div className="hidden items-center gap-5 text-sm text-zinc-200 md:flex">
              <AppLink to="/" className="transition hover:text-white">
                Home
              </AppLink>
              {showMoviesShows ? (
                <>
                  <AppLink to="/shows" className="transition hover:text-white">
                    Shows
                  </AppLink>
                  <AppLink to="/movies" className="transition hover:text-white">
                    Movies
                  </AppLink>
                </>
              ) : null}
              {showAudiobooks ? (
                <AppLink to="/audiobooks" className="transition hover:text-white">
                  Audiobooks
                </AppLink>
              ) : null}
              {showMusic ? (
                <AppLink to="/music" className="transition hover:text-white">
                  Music
                </AppLink>
              ) : null}
              {showVideoGames ? (
                <AppLink to="/video-games" className="transition hover:text-white">
                  Video Games
                </AppLink>
              ) : null}
              <Authenticated>
                <AppLink to="/my-list" className="transition hover:text-white">
                  My List
                </AppLink>
              </Authenticated>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-center gap-3",
            isSearchFocused ? "min-w-0 flex-1" : "shrink-0",
          )}
        >
          <form
            onSubmit={handleSubmit}
            className={cn(
              "flex items-center",
              isSearchFocused ? "min-w-0 flex-1 gap-3" : "justify-end",
            )}
          >
            <div
              className={cn(
                "flex items-center overflow-hidden rounded-md border border-transparent bg-black/40 transition-all duration-200",
                isSearchFocused
                  ? "min-w-0 flex-1 border-zinc-700 px-2"
                  : isSearchOpen
                    ? "w-52 border-zinc-700 px-2 md:w-72"
                    : "w-9 hover:border-zinc-700",
              )}
            >
              <button
                type={isSearchOpen && query.trim() ? "submit" : "button"}
                className="flex h-10 w-9 shrink-0 items-center justify-center text-zinc-200 transition hover:text-white md:h-9"
                aria-label={isSearchOpen ? "Search" : "Open search"}
                onClick={() => {
                  if (!isSearchOpen || !isSearchFocused) {
                    openSearch();
                  }
                }}
              >
                <MagnifyingGlassIcon className="h-5 w-5" />
              </button>
              <Input
                ref={inputRef}
                value={query}
                tabIndex={isSearchOpen || isSearchFocused ? 0 : -1}
                aria-hidden={!isSearchOpen && !isSearchFocused}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(event) => {
                  rememberSearchOrigin();
                  setIsSearchOpen(true);
                  setIsSearchFocused(true);
                  setQuery(event.target.value);
                }}
                onFocus={() => {
                  rememberSearchOrigin();
                  setIsSearchOpen(true);
                  setIsSearchFocused(true);
                }}
                onBlur={() => {
                  setIsSearchFocused(false);
                  if (!query.trim() && !isOnSearchPage) {
                    setIsSearchOpen(false);
                  }
                }}
                placeholder={searchPlaceholder}
                className={cn(
                  "h-10 border-0 bg-transparent px-1 text-base text-white placeholder:text-zinc-500 focus-visible:ring-0 md:h-9 md:text-sm",
                  !isSearchOpen &&
                    !isSearchFocused &&
                    "pointer-events-none w-0 px-0 opacity-0",
                )}
              />
              {isSearchFocused && query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="flex h-10 w-9 shrink-0 items-center justify-center text-zinc-400 transition hover:text-white md:h-9"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={clearSearch}
                >
                  <Cross2Icon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {isSearchFocused ? (
              <button
                type="button"
                className="shrink-0 px-1 text-sm font-medium text-zinc-200 transition hover:text-white"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={cancelSearch}
              >
                Cancel
              </button>
            ) : null}
          </form>
          {!isSearchFocused ? (
            <>
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
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
