import { useQuery } from "@tanstack/react-query";
import { HeartFilledIcon, StackIcon } from "@radix-ui/react-icons";
import { useSyncExternalStore } from "react";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { RecentlyPlayedMusicGrid } from "@/components/browse/RecentlyPlayedMusicGrid";
import { AppLink } from "@/components/layout/AppLink";
import { PartyStatusButton } from "@/components/party/PartyStatusButton";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { shuffleItems } from "@/lib/musicSearch";
import type { MusicBrowseResponse, MusicCatalogRow } from "@/lib/spotify";
import { getMusicBrowse } from "@/lib/spotify";
import {
  getRecentlyPlayedMusicSnapshot,
  subscribeRecentlyPlayedMusic,
} from "@/lib/recentlyPlayedMusic";
import { catalogQueryKeys } from "@/lib/queryClient";

async function loadMusicBrowsePage(): Promise<MusicCatalogRow[]> {
  const browse: MusicBrowseResponse = await getMusicBrowse();
  const rows = browse.rows.filter((row) => {
    if (row.kind === "artists") {
      return (row.artists?.length ?? 0) > 0;
    }
    return (row.albums?.length ?? 0) > 0;
  });
  // Shuffle artist shelves only so they don't read as alphabetical/popularity order.
  return rows.map((row) => {
    if (row.kind !== "artists" || !row.artists || row.artists.length < 2) {
      return row;
    }
    return { ...row, artists: shuffleItems(row.artists) };
  });
}

export function MusicPage() {
  const browseQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.browse(),
    queryFn: loadMusicBrowsePage,
  });

  const recentTracks = useSyncExternalStore(
    subscribeRecentlyPlayedMusic,
    getRecentlyPlayedMusicSnapshot,
    getRecentlyPlayedMusicSnapshot,
  );

  const rows = browseQuery.data;
  const error = browseQuery.error
    ? browseQuery.error instanceof Error
      ? browseQuery.error.message
      : "Unable to load Spotify music"
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="pt-navbar space-y-8 pb-chrome">
        <div className="flex flex-wrap items-center gap-2 px-4 md:px-12">
          <PartyStatusButton />
          <AppLink
            to="/coming-soon"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            Coming soon
          </AppLink>
        </div>

        {recentTracks.length > 0 ? (
          <RecentlyPlayedMusicGrid tracks={recentTracks} />
        ) : null}

        <section className="grid grid-cols-2 gap-2 px-4 md:gap-3 md:px-12">
          <AppLink
            to="/music/liked"
            className="flex min-h-14 items-center gap-3 rounded-md bg-gradient-to-br from-rose-700/80 to-zinc-900 px-3 py-3 transition-colors hover:from-rose-600/80 hover:to-zinc-800"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-rose-500/30">
              <HeartFilledIcon className="h-5 w-5 text-rose-200" />
            </span>
            <span className="truncate text-sm font-semibold text-white">Liked Songs</span>
          </AppLink>
          <AppLink
            to="/music/library"
            className="flex min-h-14 items-center gap-3 rounded-md bg-gradient-to-br from-teal-800/90 to-zinc-900 px-3 py-3 transition-colors hover:from-teal-700/90 hover:to-zinc-800"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-teal-500/30">
              <StackIcon className="h-5 w-5 text-teal-200" />
            </span>
            <span className="truncate text-sm font-semibold text-white">My Library</span>
          </AppLink>
        </section>

        {error ? (
          <div className="px-4 md:px-12">
            <p className="text-zinc-400">{error}</p>
          </div>
        ) : null}

        {rows === undefined && !error ? (
          <>
            <CatalogRowSkeleton title="Popular Pop Artists" />
            <CatalogRowSkeleton title="Popular Pop Albums" />
          </>
        ) : (
          (rows ?? []).map((row) => (
            <section key={row.key} className="px-4 md:px-12">
              <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">
                {row.title}
              </h2>
              <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {row.kind === "artists"
                  ? (row.artists ?? []).map((artist) => (
                      <ArtistCard key={artist.id} artist={artist} />
                    ))
                  : (row.albums ?? []).map((album) => (
                      <AlbumCard key={album.id} album={album} />
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
    <section className="px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">
        {title}
      </h2>
      <PosterRowSkeleton />
    </section>
  );
}
