import { AppLink } from "@/components/layout/AppLink";
import type { PersonSummary } from "@/lib/types";
import { getPersonPath } from "@/lib/tmdb";

type PersonCardProps = {
  person: PersonSummary;
};

export function PersonCard({ person }: PersonCardProps) {
  return (
    <AppLink
      to={getPersonPath(person.id)}
      className="group block w-36 shrink-0 md:w-44"
      data-testid="person-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <img
          src={person.profileUrl}
          alt={person.name}
          className="aspect-[2/3] w-full object-cover"
        />
      </div>
      <p className="mt-2 truncate text-sm font-medium text-zinc-200 group-hover:text-white">
        {person.name}
      </p>
      {person.knownFor ? (
        <p className="truncate text-xs text-zinc-500 group-hover:text-zinc-400">
          {person.knownFor}
        </p>
      ) : null}
    </AppLink>
  );
}
