import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { BookDownloadStatus } from "@/components/player/books/BookDownloadStatus";
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
    setSelected(null);

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
      }).catch(() => {});
    },
    [activeFileIndex, upsertProgress, workId],
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

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] md:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <Link to={getBookDetailPath(book)} className="text-sm text-zinc-400 hover:text-white">
            ← {book.title}
          </Link>
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
            Add your Real Debrid API key in Settings to open ebooks.
          </div>
        ) : null}

        {resolveState.status === "ready" && activeFile ? (
          <div className="w-full space-y-4">
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

        {selected && resolveState.status === "downloading" ? (
          <BookDownloadStatus
            source={selected}
            progress={resolveState.progress}
            mediaLabel="ebook"
            onCancel={() => setSelected(null)}
          />
        ) : null}

        {selected && resolveState.status === "failed" ? (
          <div className="w-full max-w-xl rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
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
          <div className="w-full">
            <BookSourcePicker
              sources={sources}
              loading={sourcesLoading}
              error={sourcesError}
              mediaLabel="ebook"
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
