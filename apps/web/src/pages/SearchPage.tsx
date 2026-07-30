import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AuthorCard } from "@/components/browse/AuthorCard";
import { BookCard } from "@/components/browse/BookCard";
import { MovieCard } from "@/components/browse/MovieCard";
import { PersonCard } from "@/components/browse/PersonCard";
import { Navbar } from "@/components/layout/Navbar";
import { PosterGridSkeleton } from "@/components/ui/skeleton";
import { searchBooksAll } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { searchAll } from "@/lib/tmdb";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const isBooksSearch = searchParams.get("type") === "books";

  const booksQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.search(query),
    queryFn: () => searchBooksAll(query),
    enabled: Boolean(query) && isBooksSearch,
  });

  const mediaQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.search(query),
    queryFn: () => searchAll(query),
    enabled: Boolean(query) && !isBooksSearch,
  });

  const activeQuery = isBooksSearch ? booksQuery : mediaQuery;
  const error = activeQuery.error
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : "Unable to search"
    : null;

  const bookResults = !query
    ? []
    : isBooksSearch
      ? booksQuery.data?.books
      : [];
  const authorResults = !query
    ? []
    : isBooksSearch
      ? booksQuery.data?.authors
      : [];
  const mediaResults = !query
    ? []
    : !isBooksSearch
      ? mediaQuery.data?.media
      : [];
  const peopleResults = !query
    ? []
    : !isBooksSearch
      ? mediaQuery.data?.people
      : [];

  const isLoading = Boolean(query) && activeQuery.data === undefined && !activeQuery.isError;
  const hasResults = isBooksSearch
    ? (bookResults?.length ?? 0) > 0 || (authorResults?.length ?? 0) > 0
    : (mediaResults?.length ?? 0) > 0 || (peopleResults?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode={isBooksSearch ? "books" : "media"} />
      <main className="pt-navbar mx-auto max-w-7xl px-4 pb-24 md:px-12 md:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-2 text-3xl font-bold">Search</h1>
          <p className="mb-8 text-zinc-400">
            {query
              ? `Results for "${query}"`
              : isBooksSearch
                ? "Search for a book or author."
                : "Search for a movie, show, or cast member."}
          </p>

          {error ? <p className="text-zinc-400">{error}</p> : null}
          {isLoading ? <PosterGridSkeleton count={8} /> : null}
          {!isLoading && !hasResults && query ? (
            <p className="text-zinc-400">No results found.</p>
          ) : null}

          {isBooksSearch ? (
            <>
              {!isLoading && authorResults && authorResults.length > 0 ? (
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

              {!isLoading && bookResults && bookResults.length > 0 ? (
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
          ) : (
            <>
              {!isLoading && peopleResults && peopleResults.length > 0 ? (
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

              {!isLoading && mediaResults && mediaResults.length > 0 ? (
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
