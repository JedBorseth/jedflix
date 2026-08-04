import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { AuthorCard } from "@/components/browse/AuthorCard";
import { BookCard } from "@/components/browse/BookCard";
import { MovieCard } from "@/components/browse/MovieCard";
import { PersonCard } from "@/components/browse/PersonCard";
import { PosterGridSkeleton } from "@/components/ui/skeleton";
import { searchBooksAll } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { buildSpellSuggestions } from "@/lib/searchSuggestions";
import { searchMusicAll } from "@/lib/spotify";
import { searchAll } from "@/lib/tmdb";

type SearchKind = "media" | "books" | "music";

function buildSearchPath(query: string, kind: SearchKind): string {
  const params = new URLSearchParams({ q: query });
  if (kind === "books") {
    params.set("type", "books");
  } else if (kind === "music") {
    params.set("type", "music");
  }
  return `/search?${params.toString()}`;
}

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get("q")?.trim() ?? "";
  const typeParam = searchParams.get("type");
  const searchKind: SearchKind =
    typeParam === "books" ? "books" : typeParam === "music" ? "music" : "media";

  const booksQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.search(query),
    queryFn: () => searchBooksAll(query),
    enabled: Boolean(query) && searchKind === "books",
  });

  const musicQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.search(query),
    queryFn: () => searchMusicAll(query),
    enabled: Boolean(query) && searchKind === "music",
  });

  const mediaQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.search(query),
    queryFn: () => searchAll(query),
    enabled: Boolean(query) && searchKind === "media",
  });

  const activeQuery =
    searchKind === "books" ? booksQuery : searchKind === "music" ? musicQuery : mediaQuery;
  const error = activeQuery.error
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : "Unable to search"
    : null;

  const bookResults = searchKind === "books" && query ? (booksQuery.data?.books ?? []) : [];
  const authorResults = searchKind === "books" && query ? (booksQuery.data?.authors ?? []) : [];
  const albumResults = searchKind === "music" && query ? (musicQuery.data?.albums ?? []) : [];
  const artistResults = searchKind === "music" && query ? (musicQuery.data?.artists ?? []) : [];
  const mediaResults = searchKind === "media" && query ? (mediaQuery.data?.media ?? []) : [];
  const peopleResults = searchKind === "media" && query ? (mediaQuery.data?.people ?? []) : [];

  const isLoading = Boolean(query) && activeQuery.data === undefined && !activeQuery.isError;
  const hasResults =
    searchKind === "books"
      ? bookResults.length > 0 || authorResults.length > 0
      : searchKind === "music"
        ? albumResults.length > 0 || artistResults.length > 0
        : mediaResults.length > 0 || peopleResults.length > 0;

  const spellSuggestions = useMemo(() => {
    if (!query || isLoading || !hasResults) {
      return [];
    }
    if (searchKind === "books") {
      const authors = booksQuery.data?.authors ?? [];
      const books = booksQuery.data?.books ?? [];
      return buildSpellSuggestions(query, [
        ...authors.map((author) => author.name),
        ...books.map((book) => book.title),
      ]);
    }
    if (searchKind === "music") {
      const artists = musicQuery.data?.artists ?? [];
      const albums = musicQuery.data?.albums ?? [];
      return buildSpellSuggestions(query, [
        ...artists.map((artist) => artist.name),
        ...albums.map((album) => album.name),
      ]);
    }
    const people = mediaQuery.data?.people ?? [];
    const media = mediaQuery.data?.media ?? [];
    return buildSpellSuggestions(query, [
      ...people.map((person) => person.name),
      ...media.map((item) => item.title),
    ]);
  }, [
    query,
    isLoading,
    hasResults,
    searchKind,
    booksQuery.data,
    musicQuery.data,
    mediaQuery.data,
  ]);

  const emptyHint =
    searchKind === "books"
      ? "Search for a book or author."
      : searchKind === "music"
        ? "Search for an album or artist."
        : "Search for a movie, show, or cast member.";

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-7xl px-4 pb-24 md:px-12 md:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-2 text-3xl font-bold">Search</h1>
          <p className="mb-4 text-zinc-400">
            {query ? `Results for "${query}"` : emptyHint}
          </p>

          {spellSuggestions.length > 0 ? (
            <p className="mb-8 text-sm text-zinc-400">
              <span className="text-zinc-500">Did you mean </span>
              {spellSuggestions.map((suggestion, index) => (
                <span key={suggestion.query}>
                  {index > 0 ? (
                    <span className="text-zinc-600"> · </span>
                  ) : null}
                  <button
                    type="button"
                    className="font-medium text-white underline-offset-2 transition hover:underline"
                    onClick={() => {
                      void navigate(buildSearchPath(suggestion.query, searchKind), {
                        replace: true,
                      });
                    }}
                  >
                    {suggestion.label}
                  </button>
                </span>
              ))}
              <span className="text-zinc-500">?</span>
            </p>
          ) : (
            <div className="mb-8" />
          )}

          {error ? <p className="text-zinc-400">{error}</p> : null}
          {isLoading ? <PosterGridSkeleton count={8} /> : null}
          {!isLoading && !hasResults && query ? (
            <p className="text-zinc-400">No results found.</p>
          ) : null}

          {searchKind === "books" ? (
            <>
              {!isLoading && authorResults.length > 0 ? (
                <section className="mb-10 text-left">
                  <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">
                    Authors
                  </h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    {authorResults.map((author) => (
                      <AuthorCard key={author.id} author={author} />
                    ))}
                  </div>
                </section>
              ) : null}

              {!isLoading && bookResults.length > 0 ? (
                <section className="text-left">
                  <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">
                    Books
                  </h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    {bookResults.map((book) => (
                      <BookCard key={book.id} book={book} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : searchKind === "music" ? (
            <>
              {!isLoading && artistResults.length > 0 ? (
                <section className="mb-10 text-left">
                  <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">
                    Artists
                  </h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    {artistResults.map((artist) => (
                      <ArtistCard key={artist.id} artist={artist} />
                    ))}
                  </div>
                </section>
              ) : null}

              {!isLoading && albumResults.length > 0 ? (
                <section className="text-left">
                  <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">
                    Albums
                  </h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    {albumResults.map((album) => (
                      <AlbumCard key={album.id} album={album} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <>
              {!isLoading && peopleResults.length > 0 ? (
                <section className="mb-10 text-left">
                  <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">
                    People
                  </h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    {peopleResults.map((person) => (
                      <PersonCard key={person.id} person={person} />
                    ))}
                  </div>
                </section>
              ) : null}

              {!isLoading && mediaResults.length > 0 ? (
                <section className="text-left">
                  <h2 className="mb-4 text-lg font-semibold text-white md:text-xl">
                    Titles
                  </h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    {mediaResults.map((movie) => (
                      <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
