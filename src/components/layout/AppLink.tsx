import { Link, type LinkProps } from "react-router-dom";
import { shouldUseViewTransition } from "@/lib/mobile";

export function AppLink({ viewTransition = true, ...props }: LinkProps) {
  return <Link {...props} viewTransition={viewTransition && shouldUseViewTransition()} />;
}
