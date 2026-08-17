import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useConvexAuth, useMutation, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { BookCard } from "@/components/browse/BookCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { AddToJedsPicksButton } from "@/components/jedsPicks/AddToJedsPicksButton";
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
import {
  getRecentAudiobook,
  getRecentAudiobooksSnapshot,
  hasContinueProgress,
  recordRecentAudiobook,
  subscribeRecentAudiobooks,
} from "@/lib/recentAudiobooks";

type LocationState = {
  preview?: BookItem;
};

export function AudiobookDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const location = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const touchRecent = useMutation(api.watchHistory.touchAudiobookRecent);
  const history = useConvexQuery(api.watchHistory.getForUser, isAuthenticated ? {} : "skip");
  const normalizedId = normalizeWorkId(workId ?? null);
  const preview =
    (location.state as LocationState | null)?.preview &&
    (location.state as LocationState).preview?.id === normalizedId
      ? (location.state as LocationState).preview
      : undefined;

  useSyncExternalStore(
    subscribeRecentAudiobooks,
    getRecentAudiobooksSnapshot,
    getRecentAudiobooksSnapshot,
  );

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

  useEffect(() => {
    if (!displayBook || !normalizedId || displayBook.id !== normalizedId) {
      return;
    }
    recordRecentAudiobook({
      id: displayBook.id,
      title: displayBook.title,
      coverUrl: displayBook.coverUrl,
      coverFullUrl: displayBook.coverFullUrl,
      authors: displayBook.authors,
    });
    if (isAuthenticated) {
      void touchRecent({ workId: normalizedId }).catch(() => {});
    }
  }, [displayBook, isAuthenticated, normalizedId, touchRecent]);

  const localRecent = normalizedId ? getRecentAudiobook(normalizedId) : null;
  const convexProgress = useMemo(() => {
    if (!normalizedId || !history) {
      return null;
    }
    return (
      history.find(
        (entry) => entry.mediaType === "audiobook" && entry.workId === normalizedId,
      ) ?? null
    );
  }, [history, normalizedId]);

  const progressEntry = {
    progressSeconds:
      convexProgress?.progressSeconds ?? localRecent?.progressSeconds ?? 0,
    fileIndex: convexProgress?.fileIndex ?? localRecent?.fileIndex ?? 0,
  };
  const canContinue = hasContinueProgress(progressEntry);

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
        <DetailPageSkeleton />
      </div>
    );
  }

  if (displayBook === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Book not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/audiobooks">Back to audiobooks</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  const authors = displayBook.authors ?? [];
  const authorKeys = "authorKeys" in displayBook && Array.isArray(displayBook.authorKeys)
    ? displayBook.authorKeys
    : [];
  const description =
    book?.description && book.description !== (displayBook as BookItem).description
      ? book.description
      : ("description" in displayBook && displayBook.description) || "No description available.";
  const subjects =
    book?.subjects ??
    ("subjects" in displayBook && Array.isArray(displayBook.subjects)
      ? displayBook.subjects
      : []);
  const year = "year" in displayBook ? displayBook.year : null;
  const pageCount = "pageCount" in displayBook ? displayBook.pageCount : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <section className="relative min-h-[60vh] overflow-hidden">
        <ProgressiveCoverImage
          src={displayBook.coverUrl}
          fullSrc={displayBook.coverFullUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-2xl"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-black/60" />

        <div className="pt-navbar relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-chrome md:flex-row md:items-start md:px-12">
          <div className="relative mx-auto w-56 shrink-0 self-start md:mx-0 md:w-64">
            <ProgressiveCoverImage
              src={displayBook.coverUrl}
              fullSrc={displayBook.coverFullUrl}
              alt={displayBook.title}
              className="aspect-[2/3] h-auto w-56 rounded-md object-cover shadow-2xl md:w-64"
            />
            {normalizedId ? (
              <AddToJedsPicksButton
                item={{ kind: "audiobook", workId: normalizedId }}
                className="h-8 w-8"
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col justify-end">
            <h1 className="mb-4 text-4xl font-bold md:text-5xl">{displayBook.title}</h1>
            <div className="mb-4 flex flex-wrap gap-3 text-sm text-zinc-300">
              {year ? <span>{year}</span> : null}
              {pageCount ? <span>{pageCount} pages</span> : null}
              {subjects[0] ? <span>{subjects[0]}</span> : null}
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
                  <AppLink to={getListenPath(normalizedId)}>
                    {canContinue ? "Continue" : "Listen"}
                  </AppLink>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-zinc-600">
                  <AppLink to={getReadPath(normalizedId)}>Read</AppLink>
                </Button>
                <AddToMyListButton mediaType="audiobook" workId={normalizedId} />
              </div>
            ) : null}
            {subjects.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {subjects.slice(0, 8).map((subject) => (
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
