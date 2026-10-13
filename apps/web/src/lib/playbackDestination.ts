export type PlaybackPlayer = "web" | "vlc" | "outplayer";

export function getPlaybackPlayer(
  searchParams: URLSearchParams,
): PlaybackPlayer {
  const player = searchParams.get("player");
  return player === "vlc" || player === "outplayer" ? player : "web";
}

export function getPlaybackDestinationPath(
  to: string,
  player: PlaybackPlayer,
): string {
  const url = new URL(to, "https://jedflix.local");
  url.searchParams.set("player", player);
  return `${url.pathname}${url.search}${url.hash}`;
}
