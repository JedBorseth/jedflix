import { PlayIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ArtistCard } from "@/components/browse/ArtistCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AddToJedsPicksButton } from "@/components/jedsPicks/AddToJedsPicksButton";
import { AppLink } from "@/components/layout/AppLink";
import { useMusicPlayer } from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import { getSimilarArtists } from "@/lib/lastfm";
import {
  formatTrackDuration,
  getArtistDetails,
  normalizeSpotifyId,
  type ArtistSummary,
  type TopTrackItem,
} from "@/lib/spotify";
import { catalogQueryKeys } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type LocationState = {
  preview?: ArtistSummary;
};

export function MusicArtistPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const location = useLocation();
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
  const normalizedId = normalizeSpotifyId(artistId ?? null);
  const preview =
    (location.state as LocationState | null)?.preview &&
    (location.state as LocationState).preview?.id === normalizedId
      ? (location.state as LocationState).preview
      : undefined;

  const artistQuery = useQuery({
    queryKey: catalogQueryKeys.spotify.artist(normalizedId ?? "", preview?.name ?? ""),
    queryFn: () =>
      getArtistDetails(normalizedId!, {
        name: preview?.name,
      }),
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

  const similarQuery = useQuery({
    queryKey: catalogQueryKeys.lastfm.similarArtists(artist?.name ?? ""),
    queryFn: () => getSimilarArtists(artist!.name, 6),
    enabled: Boolean(artist?.name) && artistQuery.isSuccess,
    staleTime: 30 * 60 * 1000,
  });
  const similarArtists = (similarQuery.data ?? []).filter(
    (item) => item.id && item.id !== normalizedId,
  );

  if (artist === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <DetailPageSkeleton />
      </div>
    );
  }

  if (artist === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Artist not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/music">Back to music</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  const topTracks = (artist.topTracks ?? []).slice(0, 10);
  const albums = artist.albums ?? [];
  const discography = artist.discography ?? [];
  const activeTrackId = musicPlayer.current?.id;

  function playTopFrom(index: number) {
    if (topTracks.length === 0) {
      return;
    }
    const queue = topTracks.map(topTrackToQueueTrack);
    const start = queue[Math.min(Math.max(index, 0), queue.length - 1)];
    if (!start) {
      return;
    }
    musicPlayer.playTrack(start, queue);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto max-w-6xl px-4 pb-chrome md:px-12">
        <div className="mb-10 flex flex-col items-center gap-8 md:flex-row md:items-start">
          <div className="relative w-48 shrink-0 md:w-56">
            <ProgressiveCoverImage
              src={artist.imageUrl}
              alt={artist.name}
              className="aspect-square w-48 rounded-full object-cover shadow-2xl md:w-56"
            />
            <AddToJedsPicksButton
              item={{ kind: "artist", catalogId: artist.id }}
              className="h-8 w-8"
            />
          </div>
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
            {topTracks.length > 0 ? (
              <button
                type="button"
                onClick={() => playTopFrom(0)}
                aria-label="Play popular"
                className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-black shadow-lg transition hover:scale-105 hover:bg-red-500 md:mx-0"
              >
                <PlayIcon className="h-7 w-7 translate-x-0.5 fill-current" />
              </button>
            ) : null}
          </div>
        </div>

        {topTracks.length > 0 ? (
          <section className="mb-10 -mx-4 md:-mx-12">
            <h2 className="mb-4 px-4 text-xl font-semibold md:px-12">Popular</h2>
            <div className="divide-y divide-zinc-900">
              {topTracks.map((track, index) => {
                const isActive = activeTrackId === track.id;
                const queueTrack = topTrackToQueueTrack(track);
                return (
                  <SwipeableTrackRow
                    key={track.id || `${track.name}-${index}`}
                    onPlay={() => playTopFrom(index)}
                    onAddToQueue={() => musicPlayer.addToQueue(queueTrack)}
                    onPlayNext={() => musicPlayer.playNext(queueTrack)}
                    onLike={() => void likeTrack(queueTrack)}
                  >
                    <div
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900/80 md:px-12",
                        isActive && "bg-zinc-900 text-white",
                      )}
                    >
                      <span className="w-8 shrink-0 text-center text-sm text-zinc-500">
                        {isActive && musicPlayer.playing ? "▶" : index + 1}
                      </span>
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
                        <p className="truncate text-xs text-zinc-500">
                          {track.albumName || track.artists.join(", ")}
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

        {albums.length > 0 ? (
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Albums & singles</h2>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>
        ) : null}

        {discography.length > 0 ? (
          <section className="mb-10">
            <h2 className="mb-4 text-center text-xl font-semibold">Discography</h2>
            <div className="flex flex-wrap justify-center gap-3">
              {discography.map((album) => (
                <AlbumCard key={`disc-${album.id}`} album={album} />
              ))}
            </div>
          </section>
        ) : null}

        {similarArtists.length > 0 ? (
          <section className="mb-4">
            <h2 className="mb-4 text-xl font-semibold">Similar Artists</h2>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {similarArtists.map((similar) => (
                <ArtistCard key={similar.id} artist={similar} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function topTrackToQueueTrack(track: TopTrackItem) {
  return {
    id: track.id,
    title: track.name,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName || "Unknown album",
    albumId: track.albumId || undefined,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
  };
}
