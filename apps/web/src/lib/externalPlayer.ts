import { copyTextToClipboard } from "@/lib/clipboard";
import { resolveStreamUrl } from "@/lib/streamApi";
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
  const resolved = resolveStreamUrl(playbackUrl);
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
    return resolved;
  }
  if (typeof window === "undefined") {
    return resolved;
  }
  return new URL(resolved, window.location.origin).href;
}

export function buildExternalPlayerUrl(
  player: Exclude<ExternalPlayer, "disabled">,
  playbackUrl: string,
  platform: ExternalPlayerPlatform = detectExternalPlayerPlatform(),
): string {
  const absoluteUrl = toAbsolutePlaybackUrl(playbackUrl);

  if (player === "outplayer") {
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

export async function openExternalPlayer(
  player: Exclude<ExternalPlayer, "disabled">,
  playbackUrl: string,
): Promise<{ externalUrl: string; absolutePlaybackUrl: string; copied: boolean }> {
  const absolutePlaybackUrl = toAbsolutePlaybackUrl(playbackUrl);
  const externalUrl = buildExternalPlayerUrl(player, playbackUrl);
  const copied = await copyTextToClipboard(absolutePlaybackUrl);
  window.location.href = externalUrl;
  return { externalUrl, absolutePlaybackUrl, copied };
}
