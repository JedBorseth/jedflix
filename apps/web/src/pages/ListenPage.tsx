import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { AudioPlaylistPlayer } from "@/components/player/books/AudioPlaylistPlayer";
import { BookSourcePicker } from "@/components/player/books/BookSourcePicker";
import { ResolveProgressHint } from "@/components/player/shared/ResolveProgressHint";
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

      <main className="mx-auto max-w-5xl px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:px-8">
        {!rdToken ? (
          <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-100">
            Add your Real Debrid API key in Settings to stream audiobooks.
          </div>
        ) : null}

        {resolveState.status === "ready" && files.length > 0 ? (
          <AudioPlaylistPlayer
            title={book.title}
            artist={author || book.authors.join(", ") || undefined}
            artworkUrl={book.coverFullUrl ?? book.coverUrl}
            files={files}
            packKind={resolveState.stream?.packKind}
            initialFileIndex={savedProgress?.fileIndex ?? 0}
            initialPositionSec={savedProgress?.progressSeconds ?? 0}
            onProgress={onProgress}
          />
        ) : (
          <div className="space-y-4">
            {selected && resolveState.status === "downloading" ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-center text-sm text-zinc-300">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
                <ResolveProgressHint
                  active
                  progress={resolveState.progress ?? "Resolving with Real Debrid..."}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Multi-file packs may take longer while every audio file is unrestricted.
                </p>
              </div>
            ) : null}

            {selected && resolveState.status === "failed" ? (
              <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
                <p className="font-medium text-red-100">Could not start this source</p>
                <p className="mt-2 break-words text-red-100/90">
                  {resolveState.error ?? "Unknown resolve error"}
                </p>
                {selected.title ? (
                  <p className="mt-2 text-xs text-red-200/70">Source: {selected.title}</p>
                ) : null}
                {selected.abbPostUrl ? (
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

            {!selected || resolveState.status === "idle" || resolveState.status === "failed" ? (
              <BookSourcePicker
                sources={sources}
                loading={sourcesLoading}
                error={sourcesError}
                mediaLabel="audiobook"
                selectedId={selected?.id}
                disabled={!rdToken || resolveState.status === "downloading"}
                onSelect={setSelected}
                onRetry={() => setSearchKey((value) => value + 1)}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
