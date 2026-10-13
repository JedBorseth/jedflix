import { isIosDevice } from "@/lib/iosPlayback";
import { isStandalonePwa } from "@/lib/mobile";

/**
 * Rewrite http(s) URLs to Apple's `x-safari-*` scheme so iOS home-screen PWAs
 * open the system Safari app instead of the in-app browser sheet.
 */
export function toSystemBrowserUrl(url: string): string {
  if (url.startsWith("https://")) {
    return `x-safari-${url}`;
  }
  if (url.startsWith("http://")) {
    return `x-safari-${url}`;
  }
  return url;
}

export function shouldOpenExternalInSystemBrowser() {
  return isStandalonePwa() && isIosDevice();
}

export function isExternalHttpUrl(url: string, origin = window.location.origin) {
  try {
    const parsed = new URL(url, origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return parsed.origin !== origin;
  } catch {
    return false;
  }
}

/** Open an external URL in Safari (iOS PWA) or a new tab elsewhere. */
export function openExternalUrl(url: string): void {
  if (shouldOpenExternalInSystemBrowser()) {
    window.location.href = toSystemBrowserUrl(url);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function findExternalAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null;
  }

  if (anchor.hasAttribute("download")) {
    return null;
  }

  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return null;
  }

  if (!isExternalHttpUrl(anchor.href)) {
    return null;
  }

  return anchor;
}

function handleExternalLinkClick(event: MouseEvent) {
  if (!shouldOpenExternalInSystemBrowser()) {
    return;
  }

  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const anchor = findExternalAnchor(event.target);
  if (!anchor) {
    return;
  }

  event.preventDefault();
  window.location.href = toSystemBrowserUrl(anchor.href);
}

let installed = false;

/** Capture external link clicks in the iOS standalone PWA and hand them to Safari. */
export function installExternalLinkHandler() {
  if (installed || typeof document === "undefined") {
    return;
  }

  installed = true;
  document.addEventListener("click", handleExternalLinkClick, true);
}

export function resetExternalLinkHandlerForTests() {
  if (!installed) {
    return;
  }

  document.removeEventListener("click", handleExternalLinkClick, true);
  installed = false;
}
