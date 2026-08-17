import { useMemo } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@convex/_generated/api";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { BookCard } from "@/components/browse/BookCard";
import { MovieCard } from "@/components/browse/MovieCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { pickMatchesRow, type JedsPicksRowFilter } from "@/lib/jedsPicks";
import { getWorkDetails } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { getAlbumDetails, getArtistDetails } from "@/lib/spotify";
import { getMediaDetailsByIds } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

type JedsPicksRowProps = {
  category: JedsPicksRowFilter;
  className?: string;
};

export function JedsPicksRow({ category, className }: JedsPicksRowProps) {
  const picks = useConvexQuery(api.jedsPicks.list);
  const rowPicks = useMemo(
    () => (picks ?? []).filter((pick) => pickMatchesRow(pick.kind, category)),
    [picks, category],
  );

  const videoIds = useMemo(
    () =>
      rowPicks
        .filter(
          (pick) =>
            (pick.kind === "movie" || pick.kind === "tv") &&
            typeof pick.movieId === "number",
        )
        .map((pick) => ({
          mediaType: pick.kind as "movie" | "tv",
          movieId: pick.movieId as number,
        })),
    [rowPicks],
  );

  const workIds = useMemo(
    () =>
      rowPicks
        .filter((pick) => pick.kind === "audiobook" && pick.workId)
        .map((pick) => pick.workId as string),
    [rowPicks],
  );

  const albumIds = useMemo(
    () =>
      rowPicks
        .filter((pick) => pick.kind === "album" && pick.catalogId)
        .map((pick) => pick.catalogId as string),
    [rowPicks],
  );

  const artistIds = useMemo(
    () =>
      rowPicks
        .filter((pick) => pick.kind === "artist" && pick.catalogId)
        .map((pick) => pick.catalogId as string),
    [rowPicks],
  );

  const mediaQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.detailsByIds(videoIds),
    queryFn: () => getMediaDetailsByIds(videoIds),
    enabled: picks !== undefined && videoIds.length > 0,
  });

  const booksQuery = useQuery({
    queryKey: ["jeds-picks-books", workIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        workIds.map((id) => getWorkDetails(id)),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
    },
    enabled: picks !== undefined && workIds.length > 0,
  });

  const albumsQuery = useQuery({
    queryKey: ["jeds-picks-albums", albumIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        albumIds.map((id) => getAlbumDetails(id)),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
    },
    enabled: picks !== undefined && albumIds.length > 0,
  });

  const artistsQuery = useQuery({
    queryKey: ["jeds-picks-artists", artistIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        artistIds.map((id) => getArtistDetails(id)),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
    },
    enabled: picks !== undefined && artistIds.length > 0,
  });

  if (picks === undefined) {
    return null;
  }

  if (rowPicks.length === 0) {
    return null;
  }

  const mediaById = new Map(
    (mediaQuery.data ?? []).map((item) => [`${item.mediaType}:${item.id}`, item]),
  );
  const booksById = new Map((booksQuery.data ?? []).map((book) => [book.id, book]));
  const albumsById = new Map(
    (albumsQuery.data ?? []).map((album) => [album.id, album]),
  );
  const artistsById = new Map(
    (artistsQuery.data ?? []).map((artist) => [artist.id, artist]),
  );

  const loading =
    (videoIds.length > 0 && mediaQuery.data === undefined && !mediaQuery.isError) ||
    (workIds.length > 0 && booksQuery.data === undefined && !booksQuery.isError) ||
    (albumIds.length > 0 && albumsQuery.data === undefined && !albumsQuery.isError) ||
    (artistIds.length > 0 &&
      artistsQuery.data === undefined &&
      !artistsQuery.isError);

  return (
    <section className={cn("mb-8 px-4 md:px-12", className)}>
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">
        Jed&apos;s Picks
      </h2>
      {loading ? (
        <PosterRowSkeleton count={Math.min(rowPicks.length, 6)} />
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {rowPicks.map((pick) => {
            if (pick.kind === "movie" || pick.kind === "tv") {
              const movie = mediaById.get(`${pick.kind}:${pick.movieId}`);
              if (!movie) {
                return null;
              }
              return (
                <MovieCard
                  key={`${pick.kind}-${pick.movieId}`}
                  movie={movie}
                />
              );
            }
            if (pick.kind === "audiobook") {
              const book = pick.workId ? booksById.get(pick.workId) : undefined;
              if (!book) {
                return null;
              }
              return <BookCard key={book.id} book={book} />;
            }
            if (pick.kind === "album") {
              const album = pick.catalogId
                ? albumsById.get(pick.catalogId)
                : undefined;
              if (!album) {
                return null;
              }
              return <AlbumCard key={album.id} album={album} />;
            }
            const artist = pick.catalogId
              ? artistsById.get(pick.catalogId)
              : undefined;
            if (!artist) {
              return null;
            }
            return <ArtistCard key={artist.id} artist={artist} />;
          })}
        </div>
      )}
    </section>
  );
}
