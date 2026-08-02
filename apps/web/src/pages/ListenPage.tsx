import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { AudioPlaylistPlayer } from "@/components/player/books/AudioPlaylistPlayer";
import { BookDownloadStatus } from "@/components/player/books/BookDownloadStatus";
import { BookSourcePicker } from "@/components/player/books/BookSourcePicker";
import { useStreamResolve } from "@/components/player/stremio/useStreamResolve";
import { Button } from "@/components/ui/button";
import { useUserSettings } from "@/hooks/useUserSettings";
import {
  getBookDetailPath,
  getWorkDetails,
  normalizeWorkId,
} from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { fetchSources, type ResolveRequest, type StreamSource } from "@/lib/streamApi";

export function ListenPage() {
  const { workId: rawWorkId } = useParams<{ workId: string }>();
  const workId = normalizeWorkId(rawWorkId ?? null);
  const { settings } = useUserSettings();
  const rdToken = settings.realDebridApiKey?.trim() ?? "";

  const bookQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.work(workId ?? ""),
    queryFn: () => getWorkDetails(workId!),
    enabled: Boolean(workId),
  });

  const history = useConvexQuery(api.watchHistory.getForUser);
  const upsertProgress = useMutation(api.watchHistory.upsertProgress);

  const savedProgress = useMemo(() => {
    if (!workId || !history) {
      return null;
    }
    return (
      history.find(
        (entry) => entry.mediaType === "audiobook" && entry.workId === workId,
      ) ?? null
    );
  }, [history, workId]);

  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string>();
  const [selected, setSelected] = useState<StreamSource | null>(null);
  const [searchKey, setSearchKey] = useState(0);

  const book = bookQuery.data;
  const author = book?.authors[0] ?? "";

  useEffect(() => {
    if (!book || !workId) {
      return;
    }
    let cancelled = false;
    setSourcesLoading(true);
    setSourcesError(undefined);
    setSelected(null);

    void fetchSources({
      type: "audiobook",
      title: book.title,
      author,
      query: `${book.title} ${author}`.trim(),
    })
      .then((found) => {
        if (!cancelled) {
          setSources(found);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSourcesError(error instanceof Error ? error.message : "Source search failed");
          setSources([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSourcesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [author, book, searchKey, workId]);

  const resolveRequest: ResolveRequest | null = useMemo(() => {
    if (!selected || !rdToken) {
      return null;
    }
    return {
      type: "audiobook",
      mediaTitle: book?.title,
      realDebridToken: rdToken,
      abbPostUrl: selected.abbPostUrl,
      magnet: selected.magnet,
    };
  }, [book?.title, rdToken, selected]);

  const resolveState = useStreamResolve(resolveRequest, selected);

  const onProgress = useCallback(
    (progress: { fileIndex: number; positionSec: number }) => {
      if (!workId) {
        return;
      }
      void upsertProgress({
        mediaType: "audiobook",
        workId,
        progressSeconds: progress.positionSec,
        fileIndex: progress.fileIndex,
      }).catch(() => {});
    },
    [upsertProgress, workId],
  );

  if (!workId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Book not found.
      </div>
    );
  }

  if (bookQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading book...
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-400">
        <p>Unable to load this book.</p>
        <Button asChild variant="outline">
          <Link to="/audiobooks">Back</Link>
        </Button>
      </div>
    );
  }

  const files = resolveState.stream?.files ?? [];
  const showPlayer = resolveState.status === "ready" && files.length > 0;
  const showDownload = Boolean(selected) && resolveState.status === "downloading";
  const showFailed = Boolean(selected) && resolveState.status === "failed";
  const showPicker = !showPlayer && !showDownload;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] md:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={getBookDetailPath(book)}
              className="text-sm text-zinc-400 hover:text-white"
            >
              ← {book.title}
            </Link>
          </div>
          {!rdToken ? (
            <Button asChild size="sm" className="bg-red-600 hover:bg-red-700">
              <Link to="/settings">Add Real Debrid key</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col items-center px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:px-8">
        {!rdToken ? (
          <div className="mb-6 w-full rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-100">
            Add your Real Debrid API key in Settings to stream audiobooks.
          </div>
        ) : null}

        {showPlayer ? (
          <AudioPlaylistPlayer
            title={book.title}
            files={files}
            packKind={resolveState.stream?.packKind}
            initialFileIndex={savedProgress?.fileIndex ?? 0}
            initialPositionSec={savedProgress?.progressSeconds ?? 0}
            onProgress={onProgress}
          />
        ) : null}

        {showDownload && selected ? (
          <BookDownloadStatus
            source={selected}
            progress={resolveState.progress}
            mediaLabel="audiobook"
            onCancel={() => setSelected(null)}
          />
        ) : null}

        {showFailed ? (
          <div className="w-full max-w-xl rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
            <p className="font-medium text-red-100">Could not start this source</p>
            <p className="mt-2 break-words text-red-100/90">
              {resolveState.error ?? "Unknown resolve error"}
            </p>
            {selected?.title ? (
              <p className="mt-2 text-xs text-red-200/70">Source: {selected.title}</p>
            ) : null}
            {selected?.abbPostUrl ? (
              <p className="mt-1 break-all text-xs text-red-200/60">{selected.abbPostUrl}</p>
            ) : null}
            <button
              type="button"
              className="mt-4 rounded-md bg-white px-4 py-2 text-black"
              onClick={() => setSelected(null)}
            >
              Pick another source
            </button>
          </div>
        ) : null}

        {showPicker ? (
          <div className="w-full">
            <BookSourcePicker
              sources={sources}
              loading={sourcesLoading}
              error={sourcesError}
              mediaLabel="audiobook"
              selectedId={selected?.id}
              disabled={!rdToken}
              onSelect={setSelected}
              onRetry={() => setSearchKey((value) => value + 1)}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
