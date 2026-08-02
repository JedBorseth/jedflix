import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { getArtistDetails, normalizeSpotifyId } from "@/lib/spotify";
import { catalogQueryKeys } from "@/lib/queryClient";

export function MusicArtistPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const normalizedId = normalizeSpotifyId(artistId ?? null);

  const artistQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.artist(normalizedId ?? ""),
    queryFn: () => getArtistDetails(normalizedId!),
    enabled: Boolean(normalizedId),
  });

  const artist = normalizedId ? (artistQuery.isError ? null : artistQuery.data) : null;
  const error = artistQuery.error
    ? artistQuery.error instanceof Error
      ? artistQuery.error.message
      : "Unable to load artist"
    : !normalizedId
      ? "Artist not found."
      : null;

  if (artist === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="music" />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (artist === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="music" />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Artist not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/music">Back to music</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar searchMode="music" />
      <main className="pt-navbar mx-auto max-w-6xl px-4 pb-24 md:px-12 md:pb-16">
        <div className="mb-10 flex flex-col items-center gap-8 md:flex-row md:items-start">
          <ProgressiveCoverImage
            src={artist.imageUrl}
            alt={artist.name}
            className="aspect-square w-48 shrink-0 rounded-full object-cover shadow-2xl md:w-56"
          />
          <div className="min-w-0 flex-1 text-center md:text-left">
            <p className="mb-2 text-sm font-medium uppercase tracking-widest text-red-500">
              Artist
            </p>
            <h1 className="mb-4 text-3xl font-bold md:text-5xl">{artist.name}</h1>
            <div className="mb-4 flex flex-wrap justify-center gap-3 text-sm text-zinc-400 md:justify-start">
              {artist.followers ? (
                <span>{artist.followers.toLocaleString()} followers</span>
              ) : null}
              {artist.popularity ? <span>Popularity {artist.popularity}</span> : null}
            </div>
            {artist.genres.length > 0 ? (
              <p className="mb-4 text-sm capitalize text-zinc-300">
                {artist.genres.slice(0, 6).join(" · ")}
              </p>
            ) : null}
            <p className="text-sm text-zinc-400">Playback coming soon.</p>
          </div>
        </div>

        {artist.albums.length > 0 ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold">Albums & singles</h2>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {artist.albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
