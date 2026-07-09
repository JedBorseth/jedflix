import { AppLink } from "@/components/layout/AppLink";
import type { CastMember } from "@/lib/types";
import { getPersonPath } from "@/lib/tmdb";

type CastCardProps = {
  member: CastMember;
};

export function CastCard({ member }: CastCardProps) {
  return (
    <AppLink
      to={getPersonPath(member.id)}
      className="group block w-28 shrink-0 snap-start md:w-32"
      data-testid="cast-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <img
          src={member.profileUrl}
          alt={member.name}
          className="aspect-[2/3] w-full object-cover"
        />
      </div>
      <p className="mt-2 truncate text-sm font-medium text-zinc-200 group-hover:text-white">
        {member.name}
      </p>
      <p className="truncate text-xs text-zinc-500 group-hover:text-zinc-400">
        {member.character}
      </p>
    </AppLink>
  );
}
