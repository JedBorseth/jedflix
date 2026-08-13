import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { useMusicPlayer } from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import { getRelatedMusic, topTrackToQueueFields } from "@/lib/lastfm";
import type { AlbumItem } from "@/lib/spotify";
import {
  formatTrackDuration,
  getAlbumDetails,
  getArtistAlbums,
  getArtistPath,
  normalizeSpotifyId,
} from "@/lib/spotify";
import { catalogQueryKeys } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type LocationState = {
  preview?: AlbumItem;
};

export function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const normalizedId = normalizeSpotifyId(albumId ?? null);
  const preview =
    (location.state as LocationState | null)?.preview &&
    (location.state as LocationState).preview?.id === normalizedId
      ? (location.state as LocationState).preview
      : undefined;

  const albumQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.album(
      normalizedId ?? "",
      preview?.name ?? "",
      preview?.artists?.[0] ?? "",
    ),
    queryFn: () =>
      getAlbumDetails(normalizedId!, {
        name: preview?.name,
        artists: preview?.artists,
      }),
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
  const tracks = album?.tracks ?? [];
  const primaryArtistName = displayAlbum?.artists[0] ?? "";

  const relatedArtistId = displayAlbum?.artistIds[0];
  // Lite albums shelf only — full GetArtist was ~5–50 Spotify calls per album view.
  const relatedQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.artistAlbums(
      relatedArtistId ?? "",
      primaryArtistName,
    ),
    queryFn: () =>
      getArtistAlbums(relatedArtistId!, {
        name: primaryArtistName || undefined,
        limit: 12,
      }),
    enabled: Boolean(relatedArtistId) && albumQuery.isSuccess,
  });
  const relatedAlbums =
    (relatedQuery.data ?? []).filter((item) => item.id !== normalizedId).slice(0, 12);

  const seedTracks = tracks.slice(0, 1).map((track) => ({
    artist: (track.artists[0] || primaryArtistName).trim(),
    track: track.name,
    id: track.id,
  }));
  const relatedKey = [
    primaryArtistName,
    ...seedTracks.map((seed) => `${seed.artist}:${seed.track}:${seed.id ?? ""}`),
  ].join("|");

  const lastfmRelatedQuery = useQuery({
    queryKey: catalogQueryKeys.lastfm.related(relatedKey),
    queryFn: () =>
      getRelatedMusic({
        artist: primaryArtistName,
        seeds: seedTracks,
        limit: 6,
      }),
    enabled: Boolean(primaryArtistName) && tracks.length > 0 && albumQuery.isSuccess,
    staleTime: 30 * 60 * 1000,
  });
  const recommendedTracks = (lastfmRelatedQuery.data?.tracks ?? []).filter(
    (track) => track.id && !tracks.some((albumTrack) => albumTrack.id === track.id),
  );
  const recommendedArtists = (lastfmRelatedQuery.data?.artists ?? []).filter(
    (artist) => artist.id && !displayAlbum?.artistIds.includes(artist.id),
  );

  if (album === undefined && !preview) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <DetailPageSkeleton />
      </div>
    );
  }

  if (displayAlbum === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Album not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/music">Back to music</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  function playFrom(index: number) {
    if (!album || tracks.length === 0) {
      return;
    }
    musicPlayer.playAlbumTracks(
      tracks,
      {
        id: album.id,
        name: album.name,
        imageUrl: album.imageUrl,
        artists: album.artists,
        artistIds: album.artistIds,
      },
      index,
    );
  }

  function playRecommendedFrom(index: number) {
    if (recommendedTracks.length === 0) {
      return;
    }
    const queue = recommendedTracks.map(topTrackToQueueFields);
    const start = queue[Math.min(Math.max(index, 0), queue.length - 1)];
    if (!start) {
      return;
    }
    musicPlayer.playTrack(start, queue);
  }

  const activeTrackId = musicPlayer.current?.id;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <section className="relative min-h-[50vh] overflow-hidden">
        <ProgressiveCoverImage
          src={displayAlbum.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-2xl"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-black/60" />

        <div className="pt-navbar relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-10 md:flex-row md:items-start md:px-12">
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
                  return <span key={`${name}-${index}`}>{name}</span>;
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
            {tracks.length > 0 ? (
              <Button type="button" onClick={() => playFrom(0)} className="w-fit">
                Play album
              </Button>
            ) : albumQuery.isLoading ? (
              <p className="text-sm text-zinc-400">Loading tracks…</p>
            ) : (
              <p className="text-sm text-zinc-400">No tracks available for this album.</p>
            )}
          </div>
        </div>
      </section>

      {tracks.length > 0 && album ? (
        <section className="mx-auto max-w-6xl pb-8">
          <div className="divide-y divide-zinc-900">
            {tracks.map((track, index) => {
              const isActive = activeTrackId === track.id;
              const queueTrack = {
                id:
                  track.id ||
                  `${album.id}-${track.discNumber}-${track.trackNumber}-${track.name}`,
                title: track.name,
                artists: track.artists.length > 0 ? track.artists : album.artists,
                artistIds:
                  track.artistIds && track.artistIds.length > 0
                    ? track.artistIds
                    : album.artistIds,
                albumName: album.name,
                albumId: album.id,
                imageUrl: album.imageUrl,
                durationMs: track.durationMs,
              };
              return (
                <SwipeableTrackRow
                  key={track.id || `${track.discNumber}-${track.trackNumber}-${track.name}`}
                  onPlay={() => playFrom(index)}
                  onAddToQueue={() => musicPlayer.addToQueue(queueTrack)}
                  onLike={() => void likeTrack(queueTrack)}
                >
                  <div
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900/80 md:px-12",
                      isActive && "bg-zinc-900 text-white",
                    )}
                  >
                    <span className="w-8 shrink-0 text-center text-sm text-zinc-500">
                      {isActive && musicPlayer.playing ? "▶" : track.trackNumber || index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm",
                          isActive ? "text-red-400" : "text-white",
                        )}
                      >
                        {track.name}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {(track.artists.length > 0 ? track.artists : displayAlbum.artists).join(
                          ", ",
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatTrackDuration(track.durationMs)}
                    </span>
                  </div>
                </SwipeableTrackRow>
              );
            })}
          </div>
        </section>
      ) : null}

      {recommendedTracks.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-8 md:px-12">
          <h2 className="mb-4 text-xl font-semibold">Recommended</h2>
          <div className="divide-y divide-zinc-900 rounded-lg border border-zinc-900">
            {recommendedTracks.slice(0, 8).map((track, index) => {
              const isActive = activeTrackId === track.id;
              const queueTrack = topTrackToQueueFields(track);
              return (
                <SwipeableTrackRow
                  key={track.id || `${track.name}-${index}`}
                  onPlay={() => playRecommendedFrom(index)}
                  onAddToQueue={() => musicPlayer.addToQueue(queueTrack)}
                  onLike={() => void likeTrack(queueTrack)}
                >
                  <div
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-zinc-900/80",
                      isActive && "bg-zinc-900 text-white",
                    )}
                  >
                    <ProgressiveCoverImage
                      src={track.imageUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm",
                          isActive ? "text-red-400" : "text-white",
                        )}
                      >
                        {track.name}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{track.artists.join(", ")}</p>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatTrackDuration(track.durationMs)}
                    </span>
                  </div>
                </SwipeableTrackRow>
              );
            })}
          </div>
        </section>
      ) : null}

      {recommendedArtists.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-8 md:px-12">
          <h2 className="mb-4 text-xl font-semibold">Similar Artists</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {recommendedArtists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      ) : null}

      {relatedAlbums.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-chrome md:px-12">
          <h2 className="mb-4 text-xl font-semibold">More from this artist</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {relatedAlbums.map((item) => (
              <AlbumCard key={item.id} album={item} />
            ))}
          </div>
        </section>
      ) : (
        <div className="pb-chrome" />
      )}
    </div>
  );
}
