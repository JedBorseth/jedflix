export type PlaylistSortKey = "title" | "addedAt" | "artist" | "album";

export const PLAYLIST_SORT_OPTIONS: ReadonlyArray<{
  value: PlaylistSortKey;
  label: string;
}> = [
  { value: "addedAt", label: "Date added" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
];

export const DEFAULT_PLAYLIST_SORT: PlaylistSortKey = "addedAt";

export type PlaylistSortableTrack = {
  title: string;
  artists: readonly string[];
  albumName: string;
  addedAt: number;
  position: number;
};

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Sort playlist tracks. Date added defaults newest-first; text fields A→Z. */
export function sortPlaylistTracks<T extends PlaylistSortableTrack>(
  tracks: readonly T[],
  sortBy: PlaylistSortKey,
): T[] {
  const next = [...tracks];
  next.sort((left, right) => {
    switch (sortBy) {
      case "title": {
        const byTitle = compareText(left.title, right.title);
        return byTitle !== 0 ? byTitle : left.position - right.position;
      }
      case "artist": {
        const leftArtist = left.artists.join(", ");
        const rightArtist = right.artists.join(", ");
        const byArtist = compareText(leftArtist, rightArtist);
        if (byArtist !== 0) {
          return byArtist;
        }
        const byTitle = compareText(left.title, right.title);
        return byTitle !== 0 ? byTitle : left.position - right.position;
      }
      case "album": {
        const byAlbum = compareText(left.albumName, right.albumName);
        if (byAlbum !== 0) {
          return byAlbum;
        }
        const byTitle = compareText(left.title, right.title);
        return byTitle !== 0 ? byTitle : left.position - right.position;
      }
      case "addedAt":
      default: {
        const byAdded = right.addedAt - left.addedAt;
        return byAdded !== 0 ? byAdded : left.position - right.position;
      }
    }
  });
  return next;
}
