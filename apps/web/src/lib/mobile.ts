const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

export function isMobileViewport() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function isStandalonePwa() {
  return (
    window.matchMedia(STANDALONE_MEDIA_QUERY).matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function shouldUsePosterTransition() {
  return !isMobileViewport();
}

export function shouldUseViewTransition() {
  return !isMobileViewport();
}
