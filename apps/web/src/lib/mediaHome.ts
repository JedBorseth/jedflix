export type MediaHomeTarget = {
  to: string;
  label: string;
};

/** Browse home for a detail route (movie → Movies, album → Music, …). */
export function mediaHomeForPath(pathname: string): MediaHomeTarget | null {
  if (pathname.startsWith("/movie/")) {
    return { to: "/movies", label: "Movies" };
  }
  if (pathname.startsWith("/show/")) {
    return { to: "/shows", label: "Shows" };
  }
  if (pathname.startsWith("/audiobook/")) {
    return { to: "/audiobooks", label: "Audiobooks" };
  }
  if (pathname.startsWith("/author/")) {
    return { to: "/audiobooks", label: "Audiobooks" };
  }
  if (pathname.startsWith("/album/") || pathname.startsWith("/music-artist/")) {
    return { to: "/music", label: "Music" };
  }
  if (pathname.startsWith("/music/playlist/")) {
    return { to: "/music", label: "Music" };
  }
  if (pathname === "/music/liked" || pathname === "/music/library") {
    return { to: "/music", label: "Music" };
  }
  if (pathname.startsWith("/person/")) {
    return { to: "/", label: "Home" };
  }
  return null;
}
