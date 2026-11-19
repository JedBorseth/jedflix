export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export const IOS_PLAYBACK_ERROR_HINT =
  "Safari on iOS often cannot play remux or MKV streams with DTS/Atmos audio. Compatible MP4 / H.264 / AAC releases are listed first. Try another source or an external player like VLC or OutPlayer.";
