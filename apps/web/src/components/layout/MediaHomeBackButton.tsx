import { ChevronLeftIcon } from "@radix-ui/react-icons";
import { useLocation } from "react-router-dom";
import { AppLink } from "@/components/layout/AppLink";
import { mediaHomeForPath } from "@/lib/mediaHome";

/**
 * Sits in the page's top-left padding (below the navbar) and scrolls with the
 * hero so it never covers track lists or nav controls.
 */
export function MediaHomeBackButton() {
  const { pathname } = useLocation();
  const home = mediaHomeForPath(pathname);
  if (!home) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-0 top-[var(--navbar-offset)] z-30">
      <div className="pointer-events-auto px-3 pt-1 md:px-6 md:pt-2">
        <AppLink
          to={home.to}
          aria-label={`Back to ${home.label}`}
          className="inline-flex h-8 items-center gap-0.5 rounded-full border border-white/10 bg-black/55 pl-1.5 pr-2.5 text-sm font-medium text-white shadow-lg backdrop-blur-md transition hover:border-white/20 hover:bg-black/75 md:h-9 md:pr-3"
        >
          <ChevronLeftIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span>{home.label}</span>
        </AppLink>
      </div>
    </div>
  );
}
