import { AppLink } from "@/components/layout/AppLink";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import type { AlbumItem } from "@/lib/spotify";
import { getAlbumDetailPath } from "@/lib/spotify";

type AlbumCardProps = {
  album: Pick<AlbumItem, "id" | "name" | "imageUrl" | "artists">;
  to?: string;
};

export function AlbumCard({ album, to }: AlbumCardProps) {
  const detailPath = to ?? getAlbumDetailPath(album);
  const subtitle = album.artists.length > 0 ? album.artists.join(", ") : null;

  return (
    <AppLink
      to={detailPath}
      state={to ? undefined : { preview: album }}
      className="group relative block w-36 shrink-0 snap-start md:w-40 lg:w-44 xl:w-48"
      data-testid="album-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <ProgressiveCoverImage
          src={album.imageUrl}
          alt={album.name}
          className="aspect-square w-full object-cover [contain:layout]"
          loading="lazy"
        />
      </div>
      <p className="mt-2 truncate text-sm text-zinc-300 group-hover:text-white md:mt-2.5 md:text-[15px]">{album.name}</p>
      {subtitle ? (
        <p className="truncate text-xs text-zinc-500 group-hover:text-zinc-400 md:text-sm">{subtitle}</p>
      ) : null}
    </AppLink>
  );
}
