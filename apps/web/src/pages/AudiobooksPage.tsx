import { useEffect, useState } from "react";
import { BookHeroBanner } from "@/components/browse/BookHeroBanner";
import { BookCard } from "@/components/browse/BookCard";
import { Navbar } from "@/components/layout/Navbar";
import { HeroBannerSkeleton, PosterRowSkeleton } from "@/components/ui/skeleton";
import type { AudiobookBrowseResponse, BookItem } from "@/lib/openlibrary";
import { getAudiobookBrowse, getWorkDetails, pickRandomBook } from "@/lib/openlibrary";

type CatalogRow = {
  title: string;
  subject: string;
  books: BookItem[];
};

export function AudiobooksPage() {
  const [heroBook, setHeroBook] = useState<BookItem>();
  const [rows, setRows] = useState<CatalogRow[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHeroBook(undefined);
    setRows(undefined);
    setError(null);

    getAudiobookBrowse()
      .then(async (browse: AudiobookBrowseResponse) => {
        if (cancelled) {
          return;
        }

        const catalogRows: CatalogRow[] = [
          { title: "Trending", subject: "trending", books: browse.trending },
          ...browse.rows,
        ].filter((row) => row.books.length > 0);
        setRows(catalogRows);

        const candidate = pickRandomBook(browse.trending) ?? pickRandomBook(browse.rows[0]?.books ?? []);
        if (!candidate) {
          return;
        }

        try {
          const details = await getWorkDetails(candidate.id);
          if (!cancelled) {
            setHeroBook(details);
          }
        } catch {
          if (!cancelled) {
            setHeroBook(candidate);
          }
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load Open Library titles",
          );
          setRows([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode="books" />
      {heroBook ? (
        <BookHeroBanner book={heroBook} />
      ) : error ? (
        <div className="pt-navbar flex h-[50vh] items-center justify-center px-4 text-center">
          <p className="text-zinc-400">{error}</p>
        </div>
      ) : (
        <HeroBannerSkeleton />
      )}

      <div className="-mt-16 relative z-10 pb-24 md:pb-16">
        <div className="px-4 pb-6 md:px-12">
          <h1 className="sr-only">Audiobooks</h1>
        </div>
        {rows === undefined ? (
          <>
            <CatalogRowSkeleton title="Trending" />
            <CatalogRowSkeleton title="NYT Bestsellers" />
          </>
        ) : (
          rows.map((row) => (
            <section key={row.subject} className="mb-8 px-4 md:px-12">
              <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{row.title}</h2>
              <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {row.books.map((book) => (
                  <BookCard key={book.id} book={book} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function CatalogRowSkeleton({ title }: { title: string }) {
  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
      <PosterRowSkeleton />
    </section>
  );
}
