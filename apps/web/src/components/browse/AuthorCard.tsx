import { AppLink } from "@/components/layout/AppLink";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import type { AuthorSummary } from "@/lib/openlibrary";
import { getAuthorPath } from "@/lib/openlibrary";

type AuthorCardProps = {
  author: AuthorSummary;
};

export function AuthorCard({ author }: AuthorCardProps) {
  return (
    <AppLink
      to={getAuthorPath(author.id)}
      className="group block w-36 shrink-0 md:w-44"
      data-testid="author-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <ProgressiveCoverImage
          src={author.photoUrl}
          fullSrc={author.photoFullUrl}
          alt={author.name}
          className="aspect-[2/3] w-full object-cover"
          loading="lazy"
        />
      </div>
      <p className="mt-2 truncate text-sm font-medium text-zinc-200 group-hover:text-white">
        {author.name}
      </p>
      {author.topWork ? (
        <p className="truncate text-xs text-zinc-500 group-hover:text-zinc-400">
          {author.topWork}
        </p>
      ) : null}
    </AppLink>
  );
}
