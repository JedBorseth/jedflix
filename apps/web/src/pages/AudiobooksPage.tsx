import { useEffect, useRef, useSyncExternalStore } from "react";
import { useConvexAuth, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@convex/_generated/api";
import { BookHeroBanner } from "@/components/browse/BookHeroBanner";
import { BookCard } from "@/components/browse/BookCard";
import { HeroBannerSkeleton, PosterRowSkeleton } from "@/components/ui/skeleton";
import type { AudiobookBrowseResponse, BookItem } from "@/lib/openlibrary";
import { getAudiobookBrowse, getWorkDetails, pickRandomBook } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import {
  getRecentAudiobooksSnapshot,
  recordRecentAudiobook,
  subscribeRecentAudiobooks,
} from "@/lib/recentAudiobooks";

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
  const { isAuthenticated } = useConvexAuth();
  const history = useConvexQuery(api.watchHistory.getForUser, isAuthenticated ? {} : "skip");
  const hydratedRef = useRef(false);

  const browseQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.browse(),
    queryFn: loadAudiobookBrowsePage,
  });

  const recentBooks = useSyncExternalStore(
    subscribeRecentAudiobooks,
    getRecentAudiobooksSnapshot,
    getRecentAudiobooksSnapshot,
  );

  const remoteAudiobookIds = (history ?? [])
    .filter((entry) => entry.mediaType === "audiobook" && entry.workId)
    .map((entry) => entry.workId as string);

  const missingIds = remoteAudiobookIds.filter(
    (id) => !recentBooks.some((book) => book.id === id),
  );

  const remoteBooksQuery = useQuery({
    queryKey: ["recent-audiobooks-hydrate", missingIds.join(",")],
    queryFn: async () => Promise.all(missingIds.slice(0, 12).map((id) => getWorkDetails(id))),
    enabled: isAuthenticated && missingIds.length > 0 && !hydratedRef.current,
  });

  useEffect(() => {
    if (!remoteBooksQuery.data || hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;
    for (const book of remoteBooksQuery.data) {
      const historyEntry = history?.find(
        (entry) => entry.mediaType === "audiobook" && entry.workId === book.id,
      );
      recordRecentAudiobook({
        id: book.id,
        title: book.title,
        coverUrl: book.coverUrl,
        coverFullUrl: book.coverFullUrl,
        authors: book.authors,
        openedAt: historyEntry?.lastWatchedAt ?? Date.now(),
        progressSeconds: historyEntry?.progressSeconds,
        fileIndex: historyEntry?.fileIndex,
        selectedStream: historyEntry?.selectedStreamId
          ? {
              id: historyEntry.selectedStreamId,
              title: historyEntry.selectedStreamTitle ?? "Saved stream",
              magnet: historyEntry.selectedStreamMagnet,
              abbPostUrl: historyEntry.selectedStreamAbbPostUrl,
              infoHash: historyEntry.selectedStreamInfoHash,
            }
          : undefined,
      });
    }
  }, [history, remoteBooksQuery.data]);

  const heroBook = browseQuery.data?.heroBook;
  const rows = browseQuery.data?.rows;
  const error = browseQuery.error
    ? browseQuery.error instanceof Error
      ? browseQuery.error.message
      : "Unable to load Open Library titles"
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {heroBook ? (
        <BookHeroBanner book={heroBook} />
      ) : error ? (
        <div className="pt-navbar flex h-[50vh] items-center justify-center px-4 text-center">
          <p className="text-zinc-400">{error}</p>
        </div>
      ) : (
        <HeroBannerSkeleton />
      )}

      <div className="-mt-16 relative z-10 pb-chrome">
        <div className="px-4 pb-6 md:px-12">
          <h1 className="sr-only">Audiobooks</h1>
        </div>
        {recentBooks.length > 0 ? (
          <section className="mb-8 px-4 md:px-12">
            <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">Recent</h2>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {recentBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={{
                    id: book.id,
                    title: book.title,
                    coverUrl: book.coverUrl,
                    coverFullUrl: book.coverFullUrl,
                    authors: book.authors,
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}
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
