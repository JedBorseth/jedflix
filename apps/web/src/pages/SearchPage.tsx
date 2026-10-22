import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  SearchResultRow,
  SearchResultRowBody,
} from "@/components/search/SearchResultRow";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Skeleton } from "@/components/ui/skeleton";
import { useHasRealDebridApiKey } from "@/hooks/useHasRealDebridApiKey";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import { useMusicInteractionLog } from "@/lib/musicInteractions";
import { useUserSettings } from "@/hooks/useUserSettings";
import { blockDebridMediaNavigation } from "@/lib/debridAccess";
import {
  applyServerMusicRanking,
  type RankedMusicHit,
} from "@/lib/musicSearch";
import {
  getAuthorPath,
  getBookDetailPath,
  searchBooksAll,
  type AuthorSummary,
  type BookItem,
} from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { MUSIC_SEARCH_MIN_CHARS, shouldLiveSearch } from "@/lib/searchDebounce";
import { searchResultRowClassName } from "@/lib/searchResultRowStyles";
import {
  formatTrackDuration,
  getAlbumDetailPath,
  getArtistPath,
  searchMusicAll,
  type MusicSearchTrack,
} from "@/lib/spotify";
import {
  getSuccessfulSearchesSnapshot,
  recordSuccessfulSearch,
  subscribeSuccessfulSearches,
  successfulSearchKindLabel,
  type SuccessfulSearchItem,
} from "@/lib/successfulSearches";
import { getMediaDetailPath, getPersonPath, searchAll } from "@/lib/tmdb";
import type { MediaItem, PersonSummary } from "@/lib/types";

type SearchKind = "media" | "books" | "music";

type RankedAlbum = Extract<RankedMusicHit, { kind: "album" }>["album"];
type RankedArtist = Extract<RankedMusicHit, { kind: "artist" }>["artist"];

function searchTrackToQueueTrack(track: MusicSearchTrack): MusicQueueTrack {
  return {
    id: track.id,
    title: track.name,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName || "Unknown album",
    albumId: track.albumId || undefined,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
    youtubeVideoId: track.youtubeVideoId,
  };
}

function mediaToItem(movie: MediaItem): SuccessfulSearchItem {
  return {
    id: `media:${movie.mediaType}:${movie.id}`,
    kind: movie.mediaType === "tv" ? "show" : "movie",
    title: movie.title,
    subtitle: movie.year ? String(movie.year) : undefined,
    imageUrl: movie.posterUrl,
    href: getMediaDetailPath(movie),
  };
}

function personToItem(person: PersonSummary): SuccessfulSearchItem {
  return {
    id: `person:${person.id}`,
    kind: "person",
    title: person.name,
    subtitle: person.knownFor,
    imageUrl: person.profileUrl,
    href: getPersonPath(person.id),
  };
}

function bookToItem(book: BookItem): SuccessfulSearchItem {
  return {
    id: `book:${book.id}`,
    kind: "book",
    title: book.title,
    subtitle: book.authors.length > 0 ? book.authors.join(", ") : undefined,
    imageUrl: book.coverUrl,
    href: getBookDetailPath(book),
  };
}

function authorToItem(author: AuthorSummary): SuccessfulSearchItem {
  return {
    id: `author:${author.id}`,
    kind: "author",
    title: author.name,
    subtitle: author.topWork,
    imageUrl: author.photoUrl,
    href: getAuthorPath(author.id),
  };
}

function trackToItem(
  track: MusicSearchTrack,
  queueTrack: MusicQueueTrack,
): SuccessfulSearchItem {
  const artists = track.artists.join(", ") || "Unknown artist";
  return {
    id: `track:${track.id}`,
    kind: "track",
    title: track.name,
    subtitle: `${artists} · ${formatTrackDuration(track.durationMs)}`,
    imageUrl: track.imageUrl,
    track: {
      id: queueTrack.id,
      title: queueTrack.title,
      artists: queueTrack.artists,
      artistIds: queueTrack.artistIds,
      albumName: queueTrack.albumName,
      albumId: queueTrack.albumId,
      imageUrl: queueTrack.imageUrl,
      durationMs: queueTrack.durationMs,
      youtubeVideoId: queueTrack.youtubeVideoId,
    },
  };
}

function albumToItem(album: RankedAlbum): SuccessfulSearchItem {
  return {
    id: `album:${album.id}`,
    kind: "album",
    title: album.name,
    subtitle: album.artists.length > 0 ? album.artists.join(", ") : undefined,
    imageUrl: album.imageUrl,
    href: getAlbumDetailPath(album),
  };
}

function artistToItem(artist: RankedArtist): SuccessfulSearchItem {
  return {
    id: `artist:${artist.id}`,
    kind: "artist",
    title: artist.name,
    subtitle: artist.genres.length > 0 ? artist.genres.slice(0, 2).join(", ") : undefined,
    imageUrl: artist.imageUrl,
    href: getArtistPath(artist.id),
  };
}

function SearchRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="-mx-4 md:-mx-12">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 px-4 py-3 md:px-12"
        >
          <Skeleton className="h-14 w-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const logMusic = useMusicInteractionLog();
  const hasDebridKey = useHasRealDebridApiKey();
  const { youtubeMusicSearch } = useUserSettings();
  const query = searchParams.get("q")?.trim() ?? "";
  const typeParam = searchParams.get("type");
  const searchKind: SearchKind =
    typeParam === "books" ? "books" : typeParam === "music" ? "music" : "media";

  const booksQuery = useQuery({
    queryKey: catalogQueryKeys.openLibrary.search(query),
    queryFn: () => searchBooksAll(query),
    enabled: Boolean(query) && searchKind === "books",
  });

  const musicQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.search(query, youtubeMusicSearch),
    queryFn: ({ signal }) =>
      searchMusicAll(query, { includeYoutube: youtubeMusicSearch, signal }),
    enabled: shouldLiveSearch(query, "music") && searchKind === "music",
  });

  const mediaQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.search(query),
    queryFn: () => searchAll(query),
    enabled: Boolean(query) && searchKind === "media",
  });

  const activeQuery =
    searchKind === "books" ? booksQuery : searchKind === "music" ? musicQuery : mediaQuery;
  const error = activeQuery.error
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : "Unable to search"
    : null;

  const rankedMusicHits = useMemo(() => {
    if (searchKind !== "music" || !query || !musicQuery.data) {
      return [] as RankedMusicHit[];
    }
    return applyServerMusicRanking(query, musicQuery.data);
  }, [searchKind, query, musicQuery.data]);

  useEffect(() => {
    if (searchKind !== "music" || !shouldLiveSearch(query, "music")) {
      return;
    }
    logMusic({ kind: "search", query });
  }, [logMusic, query, searchKind]);

  const resultItems = useMemo(() => {
    if (!query) {
      return [] as SuccessfulSearchItem[];
    }
    if (searchKind === "books") {
      return [
        ...(booksQuery.data?.authors ?? []).map(authorToItem),
        ...(booksQuery.data?.books ?? []).map(bookToItem),
      ];
    }
    if (searchKind === "music") {
      return rankedMusicHits.map((hit) => {
        if (hit.kind === "track") {
          return trackToItem(hit.track, searchTrackToQueueTrack(hit.track));
        }
        if (hit.kind === "album") {
          return albumToItem(hit.album);
        }
        return artistToItem(hit.artist);
      });
    }
    return [
      ...(mediaQuery.data?.media ?? []).map(mediaToItem),
      ...(mediaQuery.data?.people ?? []).map(personToItem),
    ];
  }, [query, searchKind, booksQuery.data, mediaQuery.data, rankedMusicHits]);

  const trackQueue = useMemo(
    () => resultItems.flatMap((item) => (item.track ? [item.track] : [])),
    [resultItems],
  );

  const getHistorySnapshot = useCallback(
    () => getSuccessfulSearchesSnapshot(searchKind),
    [searchKind],
  );
  const searchHistory = useSyncExternalStore(
    subscribeSuccessfulSearches,
    getHistorySnapshot,
    getHistorySnapshot,
  );

  const visibleItems = query ? resultItems : searchHistory;
  const hasResults = resultItems.length > 0;

  const musicQueryPending =
    searchKind === "music" && query.length > 0 && query.length < MUSIC_SEARCH_MIN_CHARS;
  const isLoading =
    Boolean(query) &&
    !musicQueryPending &&
    activeQuery.data === undefined &&
    !activeQuery.isError;

  const emptyHint =
    searchKind === "books"
      ? "Search for a book or author."
      : searchKind === "music"
        ? youtubeMusicSearch
          ? "Search for a song, album, or artist (Spotify + YouTube)."
          : "Search for a song, album, or artist."
        : "Search for a movie, show, or cast member.";

  function isDebridLocked(item: SuccessfulSearchItem): boolean {
    return (item.kind === "movie" || item.kind === "show") && !hasDebridKey;
  }

  function openItem(item: SuccessfulSearchItem, event: MouseEvent<HTMLElement>) {
    if (isDebridLocked(item) && blockDebridMediaNavigation()) {
      event.preventDefault();
      return;
    }
    recordSuccessfulSearch(searchKind, item);
  }

  function playItem(item: SuccessfulSearchItem) {
    const track = item.track;
    if (!track) {
      return;
    }
    const index = trackQueue.findIndex((entry) => entry.id === track.id);
    const queue = index >= 0 ? trackQueue : [track];
    musicPlayer.playTrack(track, queue);
    recordSuccessfulSearch(searchKind, item);
    if (query) {
      logMusic({
        kind: "click",
        query,
        trackId: track.id,
        title: track.title,
        artists: track.artists,
        resultId: track.id,
        resultKind: "track",
      });
    }
  }

  function renderItem(item: SuccessfulSearchItem) {
    const kindLabel = successfulSearchKindLabel(item.kind);
    const track = item.track;

    if (item.kind === "track" && track) {
      const isActive = musicPlayer.current?.id === track.id;
      return (
        <SwipeableTrackRow
          key={item.id}
          onPlay={() => playItem(item)}
          onAddToQueue={() => musicPlayer.addToQueue(track)}
          onPlayNext={() => musicPlayer.playNext(track)}
          onLike={() => void likeTrack(track)}
        >
          <div className={searchResultRowClassName({ isActive })}>
            <SearchResultRowBody
              imageUrl={item.imageUrl}
              title={item.title}
              subtitle={item.subtitle}
              trailing={kindLabel}
              isActive={isActive}
            />
          </div>
        </SwipeableTrackRow>
      );
    }

    return (
      <SearchResultRow
        key={item.id}
        to={item.href}
        title={item.title}
        subtitle={item.subtitle}
        imageUrl={item.imageUrl}
        trailing={kindLabel}
        disabled={isDebridLocked(item)}
        onClick={(event) => openItem(item, event)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-7xl px-4 pb-chrome md:px-12">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <h1 className="mb-2 text-3xl font-bold">Search</h1>
            <p className="mb-8 text-zinc-400">
              {query ? `Results for "${query}"` : emptyHint}
            </p>
          </div>

          {error ? <p className="text-center text-zinc-400">{error}</p> : null}
          {musicQueryPending ? (
            <p className="text-center text-zinc-400">Keep typing to search music.</p>
          ) : null}
          {isLoading ? <SearchRowsSkeleton /> : null}
          {!isLoading && !error && !hasResults && query && !musicQueryPending ? (
            <p className="text-center text-zinc-400">No results found.</p>
          ) : null}

          {visibleItems.length > 0 ? (
            <section
              className="-mx-4 text-left md:-mx-12"
              aria-label={query ? "Search results" : "Recent searches"}
            >
              {!query ? (
                <h2 className="mb-2 px-4 text-lg font-semibold text-white md:px-12 md:text-xl">
                  Recent searches
                </h2>
              ) : null}
              <div className="divide-y divide-zinc-900">
                {visibleItems.map(renderItem)}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
