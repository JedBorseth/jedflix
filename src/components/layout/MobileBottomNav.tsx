import { Link, useLocation } from "react-router-dom";
import { Authenticated } from "convex/react";
import { HomeIcon, BookmarkIcon, VideoIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/movies", label: "Movies", icon: VideoIcon },
  { to: "/my-list", label: "My List", icon: BookmarkIcon, requiresAuth: true },
] as const;

export function MobileBottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md md:hidden"
      aria-label="Mobile navigation"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {navItems.map(({ to, label, icon: Icon, ...item }) => {
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
    <Link
      to={to}
      viewTransition
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-1 px-2 py-3 text-xs transition-colors",
        isActive ? "text-red-500" : "text-zinc-400 hover:text-zinc-200",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
