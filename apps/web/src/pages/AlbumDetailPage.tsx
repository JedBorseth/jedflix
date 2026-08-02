import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import type { AlbumItem } from "@/lib/spotify";
import {
  getAlbumDetails,
  getArtistDetails,
  getArtistPath,
  normalizeSpotifyId,
} from "@/lib/spotify";
import { catalogQueryKeys } from "@/lib/queryClient";

type LocationState = {
  preview?: AlbumItem;
};

export function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const normalizedId = normalizeSpotifyId(albumId ?? null);
  const preview =
    (location.state as LocationState | null)?.preview &&
    (location.state as LocationState).preview?.id === normalizedId
      ? (location.state as LocationState).preview
      : undefined;

  const albumQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.album(normalizedId ?? ""),
    queryFn: () => getAlbumDetails(normalizedId!),
    enabled: Boolean(normalizedId),
  });

  const album = normalizedId ? (albumQuery.isError ? null : albumQuery.data) : null;
  const error = albumQuery.error
    ? albumQuery.error instanceof Error
      ? albumQuery.error.message
      : "Unable to load album"
    : !normalizedId
      ? "Album not found."
      : null;
  const displayAlbum = album ?? preview ?? null;

  const relatedArtistId = displayAlbum?.artistIds[0];
  const relatedQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.artist(relatedArtistId ?? ""),
    queryFn: () => getArtistDetails(relatedArtistId!),
    enabled: Boolean(relatedArtistId),
  });
  const relatedAlbums =
    relatedQuery.data?.albums.filter((item) => item.id !== normalizedId).slice(0, 12) ?? [];

  if (album === undefined && !preview) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="music" />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (displayAlbum === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar searchMode="music" />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Album not found."}</p>
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
      <section className="relative min-h-[60vh] overflow-hidden">
        <ProgressiveCoverImage
          src={displayAlbum.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-2xl"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-black/60" />

        <div className="pt-navbar relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 md:flex-row md:items-start md:px-12">
          <ProgressiveCoverImage
            src={displayAlbum.imageUrl}
            alt={displayAlbum.name}
            className="mx-auto aspect-square h-auto w-56 shrink-0 self-start rounded-md object-cover shadow-2xl md:mx-0 md:w-64"
          />
          <div className="flex min-w-0 flex-col justify-end">
            <p className="mb-2 text-sm font-medium uppercase tracking-widest text-red-500">
              {displayAlbum.albumType || "Album"}
            </p>
            <h1 className="mb-4 text-3xl font-bold md:text-5xl">{displayAlbum.name}</h1>
            <div className="mb-4 flex flex-wrap gap-2 text-sm text-zinc-300">
              {displayAlbum.artists.map((name, index) => {
                const artistId = displayAlbum.artistIds[index];
                if (!artistId) {
                  return (
                    <span key={`${name}-${index}`}>{name}</span>
                  );
                }
                return (
                  <AppLink
                    key={artistId}
                    to={getArtistPath(artistId)}
                    className="underline-offset-2 hover:underline"
                  >
                    {name}
                  </AppLink>
                );
              })}
            </div>
            <div className="mb-6 flex flex-wrap gap-3 text-sm text-zinc-400">
              {displayAlbum.year ? <span>{displayAlbum.year}</span> : null}
              {displayAlbum.totalTracks ? <span>{displayAlbum.totalTracks} tracks</span> : null}
              {displayAlbum.label ? <span>{displayAlbum.label}</span> : null}
            </div>
            {displayAlbum.genres.length > 0 ? (
              <p className="mb-6 text-sm capitalize text-zinc-400">
                {displayAlbum.genres.slice(0, 4).join(" · ")}
              </p>
            ) : null}
            <p className="max-w-2xl text-sm text-zinc-300 md:text-base">
              Playback coming soon. Browse more from this artist below.
            </p>
          </div>
        </div>
      </section>

      {relatedAlbums.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-24 md:px-12 md:pb-16">
          <h2 className="mb-4 text-xl font-semibold">More from this artist</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {relatedAlbums.map((item) => (
              <AlbumCard key={item.id} album={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
