import { Link } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function Navbar() {
  const user = useQuery(api.users.viewer);

  return (
    <header className="fixed top-0 z-50 w-full bg-gradient-to-b from-black/80 to-transparent">
      <nav className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-4 md:px-12">
        <div className="flex items-center gap-6 md:gap-10">
          <Link to="/" className="text-2xl font-bold tracking-tight text-red-600">
            JedFlix
          </Link>
          <div className="hidden items-center gap-5 text-sm text-zinc-200 md:flex">
            <Link to="/" className="transition hover:text-white">
              Home
            </Link>
            <Authenticated>
              <Link to="/my-list" className="transition hover:text-white">
                My List
              </Link>
            </Authenticated>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
