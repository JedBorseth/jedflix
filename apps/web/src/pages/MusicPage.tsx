import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { RecentlyPlayedMusicGrid } from "@/components/browse/RecentlyPlayedMusicGrid";
import { Navbar } from "@/components/layout/Navbar";
import { PartyStatusButton } from "@/components/party/PartyStatusButton";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import type { MusicBrowseResponse, MusicCatalogRow } from "@/lib/spotify";
import { getMusicBrowse } from "@/lib/spotify";
import {
  getRecentlyPlayedMusicSnapshot,
  subscribeRecentlyPlayedMusic,
} from "@/lib/recentlyPlayedMusic";
import { catalogQueryKeys } from "@/lib/queryClient";

async function loadMusicBrowsePage(): Promise<MusicCatalogRow[]> {
  const browse: MusicBrowseResponse = await getMusicBrowse();
  return browse.rows.filter((row) => {
    if (row.kind === "artists") {
      return (row.artists?.length ?? 0) > 0;
    }
    return (row.albums?.length ?? 0) > 0;
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
      <Navbar searchMode="music" />
      <div className="pt-navbar space-y-8 pb-36 md:pb-32">
        <div className="px-4 md:px-12">
          <PartyStatusButton />
        </div>

        {recentTracks.length > 0 ? (
          <RecentlyPlayedMusicGrid tracks={recentTracks} />
        ) : null}

        {error ? (
          <div className="px-4 md:px-12">
            <p className="text-zinc-400">{error}</p>
          </div>
        ) : null}

        {rows === undefined && !error ? (
          <>
            <CatalogRowSkeleton title="Pop" />
            <CatalogRowSkeleton title="Hip-Hop" />
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
