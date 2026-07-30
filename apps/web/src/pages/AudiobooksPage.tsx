import { useQuery } from "@tanstack/react-query";
import { BookHeroBanner } from "@/components/browse/BookHeroBanner";
import { BookCard } from "@/components/browse/BookCard";
import { Navbar } from "@/components/layout/Navbar";
import { HeroBannerSkeleton, PosterRowSkeleton } from "@/components/ui/skeleton";
import type { AudiobookBrowseResponse, BookItem } from "@/lib/openlibrary";
import { getAudiobookBrowse, getWorkDetails, pickRandomBook } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";

type CatalogRow = {
  title: string;
  subject: string;
  books: BookItem[];
};

type AudiobookBrowsePageData = {
  rows: CatalogRow[];
  heroBook: BookItem | undefined;
};

async function loadAudiobookBrowsePage(): Promise<AudiobookBrowsePageData> {
  const browse: AudiobookBrowseResponse = await getAudiobookBrowse();
  const catalogRows: CatalogRow[] = [
    { title: "Trending", subject: "trending", books: browse.trending },
    ...browse.rows,
  ].filter((row) => row.books.length > 0);

  const candidate =
    pickRandomBook(browse.trending) ?? pickRandomBook(browse.rows[0]?.books ?? []);
  if (!candidate) {
    return { rows: catalogRows, heroBook: undefined };
  }

  try {
    const details = await getWorkDetails(candidate.id);
    return { rows: catalogRows, heroBook: details };
  } catch {
    return { rows: catalogRows, heroBook: candidate };
  }
}

export function AudiobooksPage() {
  const browseQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.browse(),
    queryFn: loadAudiobookBrowsePage,
  });

  const heroBook = browseQuery.data?.heroBook;
  const rows = browseQuery.data?.rows;
  const error = browseQuery.error
    ? browseQuery.error instanceof Error
      ? browseQuery.error.message
      : "Unable to load Open Library titles"
    : null;

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
