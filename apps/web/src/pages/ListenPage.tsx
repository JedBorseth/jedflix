import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { AudioPlaylistPlayer } from "@/components/player/books/AudioPlaylistPlayer";
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
import {
  hasSavedStream,
  matchSavedStream,
  streamPreferenceFromSource,
} from "@/lib/savedStream";
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
  const [preferPicker, setPreferPicker] = useState(false);

  const book = bookQuery.data;
  const author = book?.authors[0] ?? "";

  useEffect(() => {
    if (!book || !workId) {
      return;
    }
    let cancelled = false;
    setSourcesLoading(true);
    setSourcesError(undefined);

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

  // Resume the previously picked stream (Continue Listening) without asking again.
  useEffect(() => {
    if (!rdToken || preferPicker || selected || history === undefined) {
      return;
    }
    if (!hasSavedStream(savedProgress)) {
      return;
    }
    const matched = matchSavedStream(sources, savedProgress);
    if (matched) {
      setSelected(matched);
    }
  }, [history, preferPicker, rdToken, savedProgress, selected, sources]);

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

  const persistSource = useCallback(
    (source: StreamSource, progressSeconds = 0, fileIndex?: number) => {
      if (!workId) {
        return;
      }
      void upsertProgress({
        mediaType: "audiobook",
        workId,
        progressSeconds,
        fileIndex,
        ...streamPreferenceFromSource(source),
      }).catch(() => {});
    },
    [upsertProgress, workId],
  );

  const onSelectSource = useCallback(
    (source: StreamSource) => {
      setPreferPicker(false);
      setSelected(source);
      persistSource(
        source,
        savedProgress?.progressSeconds ?? 0,
        savedProgress?.fileIndex,
      );
    },
    [persistSource, savedProgress?.fileIndex, savedProgress?.progressSeconds],
  );

  const onChangeSource = useCallback(() => {
    setPreferPicker(true);
    setSelected(null);
  }, []);

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
        ...(selected ? streamPreferenceFromSource(selected) : {}),
      }).catch(() => {});
    },
    [selected, upsertProgress, workId],
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
  const showPicker =
    preferPicker ||
    ((!selected || resolveState.status === "idle" || resolveState.status === "failed") &&
      !showDownload &&
      !showPlayer);

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
          <div className="flex shrink-0 items-center gap-2">
            {showPlayer || showDownload ? (
              <button
                type="button"
                className="text-sm text-zinc-400 hover:text-white"
                onClick={onChangeSource}
              >
                Change source
              </button>
            ) : null}
            {!rdToken ? (
              <Button asChild size="sm" className="bg-red-600 hover:bg-red-700">
                <Link to="/settings">Add Real Debrid key</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:px-8">
        {!rdToken ? (
          <div className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-100">
            Add your Real Debrid API key in Settings to stream audiobooks.
          </div>
        ) : null}

        {showPlayer ? (
          <AudioPlaylistPlayer
            title={book.title}
            artist={author || undefined}
            artworkUrl={book.coverFullUrl ?? book.coverUrl}
            files={files}
            packKind={resolveState.stream?.packKind}
            initialFileIndex={savedProgress?.fileIndex ?? 0}
            initialPositionSec={savedProgress?.progressSeconds ?? 0}
            onProgress={onProgress}
          />
        ) : null}

        {showDownload ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-center text-sm text-zinc-300">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
            {resolveState.progress ?? "Resuming saved source with Real Debrid..."}
            <p className="mt-2 text-xs text-zinc-500">
              {selected?.title ? `Source: ${selected.title}` : null}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Multi-file packs may take longer while every audio file is unrestricted.
            </p>
          </div>
        ) : null}

        {showFailed ? (
          <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
            <p className="font-medium text-red-100">Could not start this source</p>
            <p className="mt-2 break-words text-red-100/90">
              {resolveState.error ?? "Unknown resolve error"}
            </p>
            {selected?.title ? (
              <p className="mt-2 text-xs text-red-200/70">Source: {selected.title}</p>
            ) : null}
            <button
              type="button"
              className="mt-4 rounded-md bg-white px-4 py-2 text-black"
              onClick={onChangeSource}
            >
              Pick another source
            </button>
          </div>
        ) : null}

        {showPicker ? (
          <BookSourcePicker
            sources={sources}
            loading={sourcesLoading || history === undefined}
            error={sourcesError}
            mediaLabel="audiobook"
            selectedId={selected?.id}
            disabled={!rdToken || resolveState.status === "downloading"}
            onSelect={onSelectSource}
            onRetry={() => setSearchKey((value) => value + 1)}
          />
        ) : null}
      </main>
    </div>
  );
}
