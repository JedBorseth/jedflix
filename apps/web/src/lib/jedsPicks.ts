export const jedsPickKinds = ["movie", "tv", "audiobook", "album", "artist"] as const;
export const jedsPickCategories = ["movie", "tv", "audiobook", "music"] as const;

export type JedsPickKind = (typeof jedsPickKinds)[number];
export type JedsPickCategory = (typeof jedsPickCategories)[number];
export type JedsPicksRowFilter = JedsPickCategory | "home";

export type JedsPickIdentity = {
  kind: JedsPickKind;
  movieId?: number;
  workId?: string;
  catalogId?: string;
};

export function categoryForPickKind(kind: JedsPickKind): JedsPickCategory {
  if (kind === "album" || kind === "artist") {
    return "music";
  }
  return kind;
}

export function jedsPickKey(item: JedsPickIdentity): string {
  if (item.kind === "movie" || item.kind === "tv") {
    return `${item.kind}:${item.movieId ?? ""}`;
  }
  if (item.kind === "audiobook") {
    return `audiobook:${item.workId ?? ""}`;
  }
  return `${item.kind}:${item.catalogId ?? ""}`;
}

export function pickMatchesRow(
  kind: JedsPickKind,
  row: JedsPicksRowFilter,
): boolean {
  if (row === "home") {
    return kind === "movie" || kind === "tv";
  }
  return categoryForPickKind(kind) === row;
}
