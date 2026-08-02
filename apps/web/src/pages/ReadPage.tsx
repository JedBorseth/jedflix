import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { BookSourcePicker } from "@/components/player/books/BookSourcePicker";
import { EpubReader } from "@/components/player/books/EpubReader";
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
import { fetchSources, type ResolveRequest, type StreamFile, type StreamSource } from "@/lib/streamApi";

function isEpub(file: StreamFile) {
  return file.filename.toLowerCase().endsWith(".epub") || file.mimeType === "application/epub+zip";
}

function isPdf(file: StreamFile) {
  return file.filename.toLowerCase().endsWith(".pdf") || file.mimeType === "application/pdf";
}

export function ReadPage() {
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
      history.find((entry) => entry.mediaType === "ebook" && entry.workId === workId) ?? null
    );
  }, [history, workId]);

  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string>();
  const [selected, setSelected] = useState<StreamSource | null>(null);
  const [searchKey, setSearchKey] = useState(0);
  const [preferPicker, setPreferPicker] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState(0);

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
      type: "ebook",
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
      type: "ebook",
      mediaTitle: book?.title,
      realDebridToken: rdToken,
      abbPostUrl: selected.abbPostUrl,
      magnet: selected.magnet,
    };
  }, [book?.title, rdToken, selected]);

  const resolveState = useStreamResolve(resolveRequest, selected);
  const files = useMemo(() => resolveState.stream?.files ?? [], [resolveState.stream?.files]);

  useEffect(() => {
    if (files.length === 0) {
      return;
    }
    const preferred =
      files.findIndex(isEpub) >= 0
        ? files.findIndex(isEpub)
        : files.findIndex(isPdf) >= 0
          ? files.findIndex(isPdf)
          : 0;
    setActiveFileIndex(savedProgress?.fileIndex ?? preferred);
  }, [files, savedProgress?.fileIndex]);

  const activeFile = files[activeFileIndex] ?? files[0];

  const onSelectSource = useCallback(
    (source: StreamSource) => {
      setPreferPicker(false);
      setSelected(source);
      if (!workId) {
        return;
      }
      void upsertProgress({
        mediaType: "ebook",
        workId,
        progressSeconds: 0,
        fileIndex: savedProgress?.fileIndex,
        location: savedProgress?.location,
        ...streamPreferenceFromSource(source),
      }).catch(() => {});
    },
    [savedProgress?.fileIndex, savedProgress?.location, upsertProgress, workId],
  );

  const onChangeSource = useCallback(() => {
    setPreferPicker(true);
    setSelected(null);
  }, []);

  const onLocationChange = useCallback(
    (location: string) => {
      if (!workId) {
        return;
      }
      void upsertProgress({
        mediaType: "ebook",
        workId,
        progressSeconds: 0,
        fileIndex: activeFileIndex,
        location,
        ...(selected ? streamPreferenceFromSource(selected) : {}),
      }).catch(() => {});
    },
    [activeFileIndex, selected, upsertProgress, workId],
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

  const showReader = resolveState.status === "ready" && Boolean(activeFile);
  const showDownload = Boolean(selected) && resolveState.status === "downloading";
  const showFailed = Boolean(selected) && resolveState.status === "failed";
  const showPicker =
    preferPicker ||
    ((!selected || resolveState.status === "idle" || resolveState.status === "failed") &&
      !showDownload &&
      !showReader);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] md:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <Link to={getBookDetailPath(book)} className="text-sm text-zinc-400 hover:text-white">
            ← {book.title}
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {showReader || showDownload ? (
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
            Add your Real Debrid API key in Settings to open ebooks.
          </div>
        ) : null}

        {showReader && activeFile ? (
          <div className="space-y-4">
            {files.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {files.map((file) => (
                  <button
                    key={`${file.fileId}-${file.index}`}
                    type="button"
                    onClick={() => setActiveFileIndex(file.index)}
                    className={`rounded-md px-3 py-1.5 text-xs ${
                      file.index === activeFileIndex
                        ? "bg-red-600 text-white"
                        : "border border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {file.filename}
                  </button>
                ))}
              </div>
            ) : null}

            {isEpub(activeFile) ? (
              <EpubReader
                streamUrl={activeFile.url}
                initialLocation={savedProgress?.location}
                onLocationChange={onLocationChange}
              />
            ) : isPdf(activeFile) ? (
              <iframe
                title={activeFile.filename}
                src={activeFile.url}
                className="min-h-[80vh] w-full rounded-lg border border-zinc-800 bg-white"
              />
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-6 text-sm text-zinc-300">
                <p className="mb-3">
                  This format ({activeFile.filename}) opens best in an external reader.
                </p>
                <a
                  href={activeFile.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-400 underline"
                >
                  Open download
                </a>
              </div>
            )}
          </div>
        ) : null}

        {showDownload ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-center text-sm text-zinc-300">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
            {resolveState.progress ?? "Resuming saved source with Real Debrid..."}
          </div>
        ) : null}

        {showFailed ? (
          <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
            <p className="font-medium text-red-100">Could not start this source</p>
            <p className="mt-2 break-words text-red-100/90">
              {resolveState.error ?? "Unknown resolve error"}
            </p>
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
            mediaLabel="ebook"
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
