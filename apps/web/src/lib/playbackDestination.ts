export type PlaybackDestination = "web" | "vlc" | "outplayer" | "copy";

export function getPlaybackDestination(
  searchParams: URLSearchParams,
): PlaybackDestination {
  const player = searchParams.get("player");
  return player === "vlc" || player === "outplayer" || player === "copy"
    ? player
    : "web";
}

export function getPlaybackDestinationPath(
  to: string,
  player: PlaybackDestination,
): string {
  const url = new URL(to, "https://jedflix.local");
  url.searchParams.set("player", player);
  return `${url.pathname}${url.search}${url.hash}`;
}
