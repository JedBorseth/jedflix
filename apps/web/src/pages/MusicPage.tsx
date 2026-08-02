import { useQuery } from "@tanstack/react-query";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { MusicHeroBanner } from "@/components/browse/MusicHeroBanner";
import { Navbar } from "@/components/layout/Navbar";
import { HeroBannerSkeleton, PosterRowSkeleton } from "@/components/ui/skeleton";
import type { AlbumItem, MusicBrowseResponse, MusicCatalogRow } from "@/lib/spotify";
import { getAlbumDetails, getMusicBrowse, pickRandomAlbum } from "@/lib/spotify";
import { catalogQueryKeys } from "@/lib/queryClient";

type MusicBrowsePageData = {
  rows: MusicCatalogRow[];
  heroAlbum: AlbumItem | undefined;
};

async function loadMusicBrowsePage(): Promise<MusicBrowsePageData> {
  const browse: MusicBrowseResponse = await getMusicBrowse();
  const catalogRows = browse.rows.filter((row) => {
    if (row.kind === "artists") {
      return (row.artists?.length ?? 0) > 0;
    }
    return (row.albums?.length ?? 0) > 0;
  });

  const candidate =
    pickRandomAlbum(browse.newReleases) ??
    pickRandomAlbum(browse.rows.find((row) => row.kind === "albums")?.albums ?? []);
  if (!candidate) {
    return { rows: catalogRows, heroAlbum: undefined };
  }

  try {
    const details = await getAlbumDetails(candidate.id);
    return { rows: catalogRows, heroAlbum: details };
  } catch {
    return { rows: catalogRows, heroAlbum: candidate };
  }
}

export function MusicPage() {
  const browseQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.browse(),
    queryFn: loadMusicBrowsePage,
  });

  const heroAlbum = browseQuery.data?.heroAlbum;
  const rows = browseQuery.data?.rows;
  const error = browseQuery.error
    ? browseQuery.error instanceof Error
      ? browseQuery.error.message
      : "Unable to load Spotify music"
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode="music" />
      {heroAlbum ? (
        <MusicHeroBanner album={heroAlbum} />
      ) : error ? (
        <div className="pt-navbar flex h-[50vh] items-center justify-center px-4 text-center">
          <p className="text-zinc-400">{error}</p>
        </div>
      ) : (
        <HeroBannerSkeleton />
      )}

      <div className="-mt-16 relative z-10 pb-24 md:pb-16">
        <div className="px-4 pb-6 md:px-12">
          <h1 className="sr-only">Music</h1>
        </div>
        {rows === undefined ? (
          <>
            <CatalogRowSkeleton title="New Releases" />
            <CatalogRowSkeleton title="Popular Artists" />
          </>
        ) : (
          rows.map((row) => (
            <section key={row.key} className="mb-8 px-4 md:px-12">
              <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{row.title}</h2>
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
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
      <PosterRowSkeleton />
    </section>
  );
}
