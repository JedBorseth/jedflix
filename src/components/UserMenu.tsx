import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppLink } from "@/components/layout/AppLink";
import { useAuthActions } from "@convex-dev/auth/react";
import { PersonIcon } from "@radix-ui/react-icons";
import { ReactNode } from "react";

export function UserMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full border border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800"
        >
          <PersonIcon className="h-5 w-5" />
          <span className="sr-only">Toggle user menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 border-zinc-800 bg-zinc-950 text-zinc-100"
      >
        <DropdownMenuLabel className="truncate font-normal text-zinc-400">
          {children}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuItem asChild className="cursor-pointer focus:bg-zinc-900 focus:text-white">
          <AppLink to="/my-list">My List</AppLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer focus:bg-zinc-900 focus:text-white">
          <AppLink to="/settings">Settings</AppLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-zinc-800" />
        <SignOutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <DropdownMenuItem
      className="cursor-pointer focus:bg-zinc-900 focus:text-white"
      onClick={() => void signOut()}
    >
      Sign out
    </DropdownMenuItem>
  );
}
