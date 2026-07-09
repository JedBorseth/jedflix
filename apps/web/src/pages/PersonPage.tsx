import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FilmographyRow } from "@/components/browse/FilmographyRow";
import { KnownForRow } from "@/components/browse/KnownForRow";
import { AppLink } from "@/components/layout/AppLink";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import type { PersonDetails } from "@/lib/types";
import { getPersonDetails } from "@/lib/tmdb";

const BIO_PREVIEW_LENGTH = 320;

function truncateBiography(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

function PersonBiography({ biography }: { biography: string }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = biography.length > BIO_PREVIEW_LENGTH;
  const displayText =
    expanded || !canExpand ? biography : `${truncateBiography(biography, BIO_PREVIEW_LENGTH)}…`;

  return (
    <div className="max-w-3xl">
      <p className="whitespace-pre-line text-zinc-200">{displayText}</p>
      {canExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-auto px-0 text-zinc-400 hover:bg-transparent hover:text-white"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Read less" : "Read more"}
        </Button>
      ) : null}
    </div>
  );
}

export function PersonPage() {
  const { personId } = useParams<{ personId: string }>();
  const parsedPersonId = Number(personId);
  const [person, setPerson] = useState<PersonDetails | null>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(parsedPersonId)) {
      setPerson(null);
      return;
    }

    let cancelled = false;
    setPerson(undefined);
    setError(null);

    getPersonDetails(parsedPersonId)
      .then((details) => {
        if (!cancelled) {
          setPerson(details);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load person");
          setPerson(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [parsedPersonId]);

  if (person === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (person === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">{error ?? "Person not found."}</p>
          <Button asChild variant="outline">
            <AppLink to="/">Back to browse</AppLink>
          </Button>
        </div>
      </div>
    );
  }

  const movies = person.filmography.filter((item) => item.mediaType === "movie");
  const shows = person.filmography.filter((item) => item.mediaType === "tv");

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="pt-navbar mx-auto max-w-7xl px-4 pb-16 md:px-12">
        <div className="flex flex-col gap-8 py-8 md:flex-row md:items-start">
          <img
            src={person.profileUrl}
            alt={person.name}
            className="mx-auto aspect-[2/3] h-auto w-56 shrink-0 self-start rounded-md object-cover shadow-2xl md:mx-0 md:w-64"
          />
          <div>
            <h1 className="mb-4 text-4xl font-bold md:text-5xl">{person.name}</h1>
            {person.birthday ? (
              <p className="mb-4 text-sm text-zinc-400">Born {person.birthday}</p>
            ) : null}
            <PersonBiography key={person.id} biography={person.biography} />
            <div className="mt-6">
              <Button asChild variant="outline" className="border-zinc-600">
                <AppLink to="/">Back to browse</AppLink>
              </Button>
            </div>
          </div>
        </div>

        {person.filmography.length === 0 ? (
          <p className="text-zinc-400">No filmography available.</p>
        ) : (
          <>
            <KnownForRow items={person.knownFor} />
            <FilmographyRow title="Movies" items={movies} />
            <FilmographyRow title="TV Shows" items={shows} />
          </>
        )}
      </main>
    </div>
  );
}
