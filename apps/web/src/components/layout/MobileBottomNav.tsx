import { useLocation } from "react-router-dom";
import { Authenticated } from "convex/react";
import {
  BookmarkIcon,
  CubeIcon,
  HomeIcon,
  LayersIcon,
  ReaderIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import { AppLink } from "@/components/layout/AppLink";
import { useUserSettings } from "@/hooks/useUserSettings";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/lib/userSettings";

type NavItem = {
  to: string;
  label: string;
  icon: typeof HomeIcon;
  contentType?: ContentType;
  requiresAuth?: boolean;
};

const navItems: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/shows", label: "Shows", icon: LayersIcon, contentType: "movies_shows" },
  { to: "/movies", label: "Movies", icon: VideoIcon, contentType: "movies_shows" },
  { to: "/audiobooks", label: "Audiobooks", icon: ReaderIcon, contentType: "audiobooks" },
  { to: "/video-games", label: "Games", icon: CubeIcon, contentType: "video_games" },
  { to: "/my-list", label: "My List", icon: BookmarkIcon, requiresAuth: true },
];

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const { contentTypes } = useUserSettings();

  const visibleItems = navItems.filter((item) => {
    if (!item.contentType) {
      return true;
    }
    return contentTypes.includes(item.contentType);
  });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md md:hidden"
      aria-label="Mobile navigation"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
        {visibleItems.map(({ to, label, icon: Icon, ...item }) => {
          if ("requiresAuth" in item && item.requiresAuth) {
            return (
              <Authenticated key={to}>
                <NavLink to={to} label={label} icon={Icon} isActive={pathname === to} />
              </Authenticated>
            );
          }

          return (
            <NavLink
              key={to}
              to={to}
              label={label}
              icon={Icon}
              isActive={pathname === to}
            />
          );
        })}
      </div>
    </nav>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  isActive,
}: {
  to: string;
  label: string;
  icon: typeof HomeIcon;
  isActive: boolean;
}) {
  return (
    <AppLink
      to={to}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px] transition-colors sm:text-xs",
        isActive ? "text-red-500" : "text-zinc-400 hover:text-zinc-200",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{label}</span>
    </AppLink>
  );
}
