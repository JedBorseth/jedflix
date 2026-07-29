import { useEffect, useState } from "react";
import { BookCard } from "./BookCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import type { BookItem } from "@/lib/openlibrary";
import { getSubjectBooks } from "@/lib/openlibrary";

type BookRowProps = {
  title: string;
  subject: string;
};

export function BookRow({ title, subject }: BookRowProps) {
  const [books, setBooks] = useState<BookItem[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBooks(undefined);
    setError(null);

    getSubjectBooks(subject)
      .then((items) => {
        if (!cancelled) {
          setBooks(items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load books");
          setBooks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [subject]);

  if (books === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
        <PosterRowSkeleton />
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
        <p className="text-sm text-zinc-500">{error}</p>
      </section>
    );
  }

  if (books.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </section>
  );
}
