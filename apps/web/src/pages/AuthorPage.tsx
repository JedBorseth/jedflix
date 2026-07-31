import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { BookCard } from "@/components/browse/BookCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { getAuthorDetails, normalizeAuthorId } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";

const BIO_PREVIEW_LENGTH = 320;

function truncateBiography(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

function AuthorBiography({ biography }: { biography: string }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = biography.length > BIO_PREVIEW_LENGTH;
  const displayText =
    expanded || !canExpand ? biography : `${truncateBiography(biography, BIO_PREVIEW_LENGTH)}…`;

  return (
    <div className="max-w-3xl">
      <p className="whitespace-pre-line text-zinc-200">{displayText}</p>
      {canExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-auto px-0 text-zinc-400 hover:bg-transparent hover:text-white"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Read less" : "Read more"}
        </Button>
      ) : null}
    </div>
  );
}

export function AuthorPage() {
  const { authorId } = useParams<{ authorId: string }>();
  const normalizedId = normalizeAuthorId(authorId ?? null);

  const authorQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.author(normalizedId ?? ""),
    queryFn: () => getAuthorDetails(normalizedId!),
    enabled: Boolean(normalizedId),
  });

  const author = normalizedId
    ? authorQuery.isError
      ? null
      : authorQuery.data
    : null;
  const error = authorQuery.error
    ? authorQuery.error instanceof Error
      ? authorQuery.error.message
      : "Unable to load author"
    : !normalizedId
      ? "Author not found."
      : null;

  if (author === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="books" />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (author === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="books" />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Author not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/audiobooks">Back to audiobooks</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode="books" />
      <main className="pt-navbar mx-auto max-w-6xl px-4 pb-24 md:px-12 md:pb-16">
        <div className="mb-10 flex flex-col gap-8 md:flex-row">
          <ProgressiveCoverImage
            src={author.photoUrl}
            fullSrc={author.photoFullUrl}
            alt={author.name}
            className="mx-auto w-48 shrink-0 rounded-md shadow-2xl md:mx-0 md:w-56"
          />
          <div>
            <h1 className="mb-3 text-4xl font-bold md:text-5xl">{author.name}</h1>
            {author.birthDate ? (
              <p className="mb-4 text-sm text-zinc-400">Born {author.birthDate}</p>
            ) : null}
            <AuthorBiography biography={author.biography} />
          </div>
        </div>

        {author.works.length > 0 ? (
          <section>
            <h2 className="mb-4 text-lg font-semibold md:text-xl">Books</h2>
            <div className="flex flex-wrap gap-4">
              {author.works.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          </section>
        ) : (
          <p className="text-zinc-400">No books found for this author.</p>
        )}
      </main>
    </div>
  );
}
