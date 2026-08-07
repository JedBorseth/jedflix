import { AppLink } from "@/components/layout/AppLink";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import type { ArtistSummary } from "@/lib/spotify";
import { getArtistPath } from "@/lib/spotify";

type ArtistCardProps = {
  artist: ArtistSummary;
};

export function ArtistCard({ artist }: ArtistCardProps) {
  const subtitle =
    artist.genres.length > 0
      ? artist.genres.slice(0, 2).join(", ")
      : artist.followers
        ? `${artist.followers.toLocaleString()} followers`
        : null;

  return (
    <AppLink
      to={getArtistPath(artist.id)}
      state={{ preview: artist }}
      className="group block w-36 shrink-0 snap-start md:w-44"
      data-testid="artist-card"
    >
      <div className="overflow-hidden rounded-full transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <ProgressiveCoverImage
          src={artist.imageUrl}
          alt={artist.name}
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      </div>
      <p className="mt-2 truncate text-center text-sm font-medium text-zinc-200 group-hover:text-white">
        {artist.name}
      </p>
      {subtitle ? (
        <p className="truncate text-center text-xs capitalize text-zinc-500 group-hover:text-zinc-400">
          {subtitle}
        </p>
      ) : null}
    </AppLink>
  );
}
