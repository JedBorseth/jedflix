import { MovieCard } from "@/components/browse/MovieCard";
import type { FilmographyItem } from "@/lib/types";

type FilmographyRowProps = {
  title: string;
  items: FilmographyItem[];
};

export function FilmographyRow({ title, items }: FilmographyRowProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">
        {title}
        <span className="ml-2 text-sm font-normal text-zinc-500">({items.length})</span>
      </h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {items.map((item) => (
          <div key={`${item.mediaType}-${item.id}`} className="flex flex-col items-center">
            <MovieCard movie={item} />
            {item.character ? (
              <p className="mt-1 max-w-36 truncate text-xs text-zinc-500 md:max-w-44">
                as {item.character}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
