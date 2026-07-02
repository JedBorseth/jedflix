const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

export function isMobileViewport() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function shouldUsePosterTransition() {
  return !isMobileViewport();
}
