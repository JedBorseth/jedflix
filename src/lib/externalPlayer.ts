import type { ExternalPlayer } from "@/lib/userSettings";

export type ExternalPlayerPlatform = "ios" | "android" | "desktop";

export function detectExternalPlayerPlatform(): ExternalPlayerPlatform {
  if (typeof navigator === "undefined") {
    return "desktop";
  }

  const userAgent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return "ios";
  }
  if (/Android/.test(userAgent)) {
    return "android";
  }
  return "desktop";
}

export function toAbsolutePlaybackUrl(playbackUrl: string): string {
  if (playbackUrl.startsWith("http://") || playbackUrl.startsWith("https://")) {
    return playbackUrl;
  }
  return new URL(playbackUrl, window.location.origin).href;
}

export function buildExternalPlayerUrl(
  player: Exclude<ExternalPlayer, "disabled">,
  playbackUrl: string,
  platform: ExternalPlayerPlatform = detectExternalPlayerPlatform(),
): string {
  const absoluteUrl = toAbsolutePlaybackUrl(playbackUrl);

  if (player === "outplayer") {
    if (platform === "ios") {
      return `outplayer://${absoluteUrl.replace(/^https?:\/\//, "")}`;
    }
    return `outplayer://${absoluteUrl}`;
  }

  if (player === "vlc") {
    if (platform === "ios") {
      return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(absoluteUrl)}`;
    }
    if (platform === "android") {
      const parsed = new URL(absoluteUrl);
      return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;package=org.videolan.vlc;type=video;scheme=${parsed.protocol.replace(":", "")};end`;
    }
    return `vlc://${absoluteUrl}`;
  }

  return absoluteUrl;
}

export function getExternalPlayerLabel(player: Exclude<ExternalPlayer, "disabled">): string {
  if (player === "vlc") {
    return "VLC";
  }
  return "OutPlayer";
}

export function openExternalPlayer(
  player: Exclude<ExternalPlayer, "disabled">,
  playbackUrl: string,
): void {
  window.location.href = buildExternalPlayerUrl(player, playbackUrl);
}
