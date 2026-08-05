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

  // Did-you-mean is title-only and separate from people/artist/author hits.
  const spellSuggestions = useMemo(() => {
    if (!query || isLoading) {
      return [];
    }
    if (searchKind === "books") {
      return buildSpellSuggestions(
        query,
        (booksQuery.data?.books ?? []).map((book) => book.title),
      );
    }
    if (searchKind === "music") {
      return buildSpellSuggestions(
        query,
        (musicQuery.data?.albums ?? []).map((album) => album.name),
      );
    }
    return buildSpellSuggestions(
      query,
      (mediaQuery.data?.media ?? []).map((item) => item.title),
    );
  }, [query, isLoading, searchKind, booksQuery.data, musicQuery.data, mediaQuery.data]);

  const emptyHint =
    searchKind === "books"
      ? "Search for a book or author."
      : searchKind === "music"
        ? "Search for an album or artist."
        : "Search for a movie, show, or cast member.";

  function applySpellSuggestion(suggestionQuery: string) {
    void navigate(buildSearchPath(suggestionQuery, searchKind), {
      replace: true,
    });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-7xl px-4 pb-24 md:px-12 md:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-2 text-3xl font-bold">Search</h1>
          <p className="mb-8 text-zinc-400">
            {query ? `Results for "${query}"` : emptyHint}
          </p>

          {spellSuggestions.length > 0 ? (
            <section
              className="mb-10 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-left"
              aria-label="Did you mean"
            >
              <p className="mb-3 text-sm font-medium text-zinc-400">Did you mean?</p>
              <ul className="flex flex-col gap-2">
                {spellSuggestions.map((suggestion) => (
                  <li key={suggestion.query}>
                    <button
                      type="button"
                      className="w-full rounded-md px-3 py-2 text-left text-base font-medium text-white transition hover:bg-zinc-800"
                      onClick={() => applySpellSuggestion(suggestion.query)}
                    >
                      {suggestion.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {error ? <p className="text-zinc-400">{error}</p> : null}
          {isLoading ? <PosterGridSkeleton count={8} /> : null}
          {!isLoading && !hasResults && query ? (
            <p className="text-zinc-400">No results found.</p>
          ) : null}

          {searchKind === "books" ? (
            <>
              {!isLoading && bookResults.length > 0 ? (
                <section className="mb-10 text-left">
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

              {!isLoading && authorResults.length > 0 ? (
                <section className="text-left">
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
            </>
          ) : searchKind === "music" ? (
            <>
              {!isLoading && albumResults.length > 0 ? (
                <section className="mb-10 text-left">
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

              {!isLoading && artistResults.length > 0 ? (
                <section className="text-left">
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
            </>
          ) : (
            <>
              {!isLoading && mediaResults.length > 0 ? (
                <section className="mb-10 text-left">
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

              {!isLoading && peopleResults.length > 0 ? (
                <section className="text-left">
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
