import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { BookCard } from "@/components/browse/BookCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
import { AddToMyListButton } from "@/components/mylist/AddToMyListButton";
import { MediaReviews } from "@/components/reviews/MediaReviews";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import type { BookItem } from "@/lib/openlibrary";
import {
  getAuthorPath,
  getListenPath,
  getReadPath,
  getWorkDetails,
  normalizeWorkId,
  searchBooks,
} from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";

type LocationState = {
  preview?: BookItem;
};

export function AudiobookDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const location = useLocation();
  const normalizedId = normalizeWorkId(workId ?? null);
  const preview =
    (location.state as LocationState | null)?.preview &&
    (location.state as LocationState).preview?.id === normalizedId
      ? (location.state as LocationState).preview
      : undefined;

  const bookQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.work(normalizedId ?? ""),
    queryFn: () => getWorkDetails(normalizedId!),
    enabled: Boolean(normalizedId),
  });

  const book = normalizedId
    ? bookQuery.isError
      ? null
      : bookQuery.data
    : null;
  const error = bookQuery.error
    ? bookQuery.error instanceof Error
      ? bookQuery.error.message
      : "Unable to load book"
    : !normalizedId
      ? "Book not found."
      : null;
  const displayBook = book ?? preview ?? null;

  const author = book?.authors[0];
  const relatedQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.relatedByAuthor(
      author ?? "",
      normalizedId ?? "",
    ),
    queryFn: async () => {
      const items = await searchBooks(author!);
      return items.filter((item) => item.id !== normalizedId).slice(0, 10);
    },
    enabled: Boolean(author && normalizedId),
  });

  const related = relatedQuery.data ?? [];

  if (book === undefined && !preview) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="books" />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (displayBook === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="books" />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Book not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/audiobooks">Back to audiobooks</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  const authors = displayBook.authors;
  const authorKeys = displayBook.authorKeys;
  const description =
    book?.description && book.description !== displayBook.description
      ? book.description
      : displayBook.description || "No description available.";

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode="books" />
      <section className="relative min-h-[60vh] overflow-hidden">
        <ProgressiveCoverImage
          src={displayBook.coverUrl}
          fullSrc={displayBook.coverFullUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-2xl"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-black/60" />

        <div className="pt-navbar relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 md:flex-row md:items-start md:px-12">
          <ProgressiveCoverImage
            src={displayBook.coverUrl}
            fullSrc={displayBook.coverFullUrl}
            alt={displayBook.title}
            className="mx-auto aspect-[2/3] h-auto w-56 shrink-0 self-start rounded-md object-cover shadow-2xl md:mx-0 md:w-64"
          />
          <div className="flex min-w-0 flex-col justify-end">
            <h1 className="mb-4 text-4xl font-bold md:text-5xl">{displayBook.title}</h1>
            <div className="mb-4 flex flex-wrap gap-3 text-sm text-zinc-300">
              {displayBook.year ? <span>{displayBook.year}</span> : null}
              {displayBook.pageCount ? <span>{displayBook.pageCount} pages</span> : null}
              {displayBook.subjects[0] ? <span>{displayBook.subjects[0]}</span> : null}
            </div>
            {authors.length > 0 ? (
              <p className="mb-4 text-zinc-300">
                By{" "}
                {authors.map((name, index) => {
                  const authorId = authorKeys[index];
                  const separator = index < authors.length - 1 ? ", " : "";
                  if (!authorId) {
                    return (
                      <span key={`${name}-${index}`}>
                        {name}
                        {separator}
                      </span>
                    );
                  }
                  return (
                    <span key={authorId}>
                      <AppLink
                        to={getAuthorPath(authorId)}
                        className="text-white underline-offset-4 hover:underline"
                      >
                        {name}
                      </AppLink>
                      {separator}
                    </span>
                  );
                })}
              </p>
            ) : null}
            <p className="mb-8 max-w-2xl whitespace-pre-line text-zinc-200">{description}</p>
            {normalizedId ? (
              <div className="mb-6 flex flex-wrap gap-3">
                <Button asChild size="lg" className="bg-red-600 hover:bg-red-700">
                  <AppLink to={getListenPath(normalizedId)}>Listen</AppLink>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-zinc-600">
                  <AppLink to={getReadPath(normalizedId)}>Read</AppLink>
                </Button>
                <AddToMyListButton mediaType="audiobook" workId={normalizedId} />
              </div>
            ) : null}
            {(book?.subjects ?? displayBook.subjects).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(book?.subjects ?? displayBook.subjects).slice(0, 8).map((subject) => (
                  <span
                    key={subject}
                    className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
                  >
                    {subject}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {related.length > 0 ? (
        <section className="relative z-10 bg-zinc-950 px-4 pb-12 md:px-12">
          <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">Related books</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {related.map((item) => (
              <BookCard key={item.id} book={item} />
            ))}
          </div>
        </section>
      ) : null}

      {normalizedId ? (
        <div className="relative z-10 bg-zinc-950">
          <MediaReviews mediaType="audiobook" workId={normalizedId} />
        </div>
      ) : null}
    </div>
  );
}
