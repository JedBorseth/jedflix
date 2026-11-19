import { readEnv } from "./env";

export const DEFAULT_SPOTIFY_RETURN_PATH = "/music";

export function spotifySiteUrl(): URL {
  return new URL(readEnv("SITE_URL") ?? "http://localhost:5173");
}

export function safeSpotifyReturnPath(path: string, siteUrl: URL): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return DEFAULT_SPOTIFY_RETURN_PATH;
  }

  try {
    if (new URL(path, siteUrl).origin === siteUrl.origin) {
      return path;
    }
  } catch {
    // Malformed URLs also go back to the music page.
  }
  return DEFAULT_SPOTIFY_RETURN_PATH;
}
