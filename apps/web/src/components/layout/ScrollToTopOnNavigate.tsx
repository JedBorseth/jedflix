import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { isMobileViewport } from "@/lib/mobile";

export function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    if (isMobileViewport()) {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  return null;
}
