import { PlayIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { AlbumCard } from "@/components/browse/AlbumCard";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
import { useMusicPlayer } from "@/components/player/music/MusicPlayerContext";
import { SwipeableTrackRow } from "@/components/player/music/SwipeableTrackRow";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useLikeTrack } from "@/hooks/useLikeTrack";
import {
  formatTrackDuration,
  getArtistDetails,
  normalizeSpotifyId,
  type TopTrackItem,
} from "@/lib/spotify";
import { catalogQueryKeys } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export function MusicArtistPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const musicPlayer = useMusicPlayer();
  const likeTrack = useLikeTrack();
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
      <Navbar searchMode="music" />
      <main className="pt-navbar mx-auto max-w-6xl px-4 pb-36 md:px-12 md:pb-32">
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
          <section>
            <h2 className="mb-4 text-center text-xl font-semibold">Discography</h2>
            <div className="flex flex-wrap justify-center gap-3">
              {discography.map((album) => (
                <AlbumCard key={`disc-${album.id}`} album={album} />
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
