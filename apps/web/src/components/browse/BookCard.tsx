import { AppLink } from "@/components/layout/AppLink";
import type { BookItem } from "@/lib/openlibrary";
import { getBookDetailPath } from "@/lib/openlibrary";

type BookCardProps = {
  book: BookItem;
};

export function BookCard({ book }: BookCardProps) {
  const detailPath = getBookDetailPath(book);
  const subtitle = book.authors.length > 0 ? book.authors.join(", ") : null;

  return (
    <AppLink
      to={detailPath}
      state={{ preview: book }}
      className="group relative block w-36 shrink-0 snap-start md:w-44"
      data-testid="book-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <img
          src={book.coverUrl}
          alt={book.title}
          className="aspect-[2/3] w-full object-cover [contain:layout]"
          loading="lazy"
        />
      </div>
      <p className="mt-2 truncate text-sm text-zinc-300 group-hover:text-white">
        {book.title}
      </p>
      {subtitle ? (
        <p className="truncate text-xs text-zinc-500 group-hover:text-zinc-400">
          {subtitle}
        </p>
      ) : null}
    </AppLink>
  );
}
