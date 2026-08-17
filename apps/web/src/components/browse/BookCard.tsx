import { AppLink } from "@/components/layout/AppLink";
import { AddToJedsPicksButton } from "@/components/jedsPicks/AddToJedsPicksButton";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import type { BookItem } from "@/lib/openlibrary";
import { getBookDetailPath } from "@/lib/openlibrary";

type BookCardProps = {
  book: Pick<BookItem, "id" | "title" | "coverUrl" | "coverFullUrl" | "authors">;
  to?: string;
};

export function BookCard({ book, to }: BookCardProps) {
  const detailPath = to ?? getBookDetailPath(book);
  const subtitle = book.authors.length > 0 ? book.authors.join(", ") : null;

  return (
    <div className="group relative w-36 shrink-0 snap-start md:w-44">
      <AppLink
        to={detailPath}
        state={to ? undefined : { preview: book }}
        className="block"
        data-testid="book-card"
      >
        <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
          <ProgressiveCoverImage
            src={book.coverUrl}
            fullSrc={book.coverFullUrl}
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
      <AddToJedsPicksButton item={{ kind: "audiobook", workId: book.id }} />
    </div>
  );
}
