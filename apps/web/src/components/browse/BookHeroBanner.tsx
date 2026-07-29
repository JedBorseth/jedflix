import { AppLink } from "@/components/layout/AppLink";
import { Button } from "@/components/ui/button";
import type { BookItem } from "@/lib/openlibrary";
import { getBookDetailPath } from "@/lib/openlibrary";

type BookHeroBannerProps = {
  book: BookItem;
};

export function BookHeroBanner({ book }: BookHeroBannerProps) {
  const authors = book.authors.length > 0 ? book.authors.join(", ") : null;

  return (
    <section className="relative h-[70vh] min-h-[420px] w-full overflow-hidden">
      <img
        src={book.coverUrl}
        alt=""
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-black/40" />

      <div className="pt-navbar relative z-10 flex h-full max-w-5xl items-end gap-8 px-4 pb-16 md:px-12">
        <img
          src={book.coverUrl}
          alt={book.title}
          className="hidden aspect-[2/3] h-auto w-44 shrink-0 self-end rounded-md object-cover shadow-2xl md:block"
        />
        <div className="flex max-w-2xl flex-col justify-end">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-red-500">
            Featured
          </p>
          <h1 className="mb-4 text-4xl font-bold text-white md:text-6xl">{book.title}</h1>
          {authors ? (
            <p className="mb-3 text-sm text-zinc-300 md:text-base">{authors}</p>
          ) : null}
          <p className="mb-4 line-clamp-3 text-sm text-zinc-200 md:text-base">
            {book.description || "Discover this title and more audiobooks."}
          </p>
          <div className="mb-6 flex flex-wrap gap-3 text-sm text-zinc-300">
            {book.year ? <span>{book.year}</span> : null}
            {book.subjects[0] ? <span>{book.subjects[0]}</span> : null}
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <Button
              asChild
              size="lg"
              className="bg-white text-black hover:bg-zinc-200"
            >
              <AppLink to={getBookDetailPath(book)} state={{ preview: book }}>
                More Info
              </AppLink>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
