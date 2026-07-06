import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-zinc-800", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

function PosterCardSkeleton() {
  return (
    <div className="w-36 shrink-0 md:w-44">
      <Skeleton className="aspect-[2/3] w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
    </div>
  );
}

function PosterRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, index) => (
        <PosterCardSkeleton key={index} />
      ))}
    </div>
  );
}

function PosterGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <PosterCardSkeleton key={index} />
      ))}
    </div>
  );
}

function HeroBannerSkeleton() {
  return (
    <section className="relative h-[70vh] min-h-[420px] w-full overflow-hidden bg-zinc-900">
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-black/30" />
      <div className="pt-navbar relative z-10 flex h-full max-w-2xl flex-col justify-end px-4 pb-16 md:px-12">
        <Skeleton className="mb-2 h-4 w-20" />
        <Skeleton className="mb-4 h-10 w-3/4 md:h-14" />
        <Skeleton className="mb-4 h-16 w-full" />
        <div className="mb-6 flex gap-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-11 w-24 rounded-md" />
          <Skeleton className="h-11 w-28 rounded-md" />
        </div>
      </div>
    </section>
  );
}

function DetailPageSkeleton() {
  return (
    <section className="relative min-h-[60vh] bg-zinc-900">
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-black/40" />
      <div className="pt-navbar relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 md:flex-row md:px-12">
        <Skeleton className="mx-auto aspect-[2/3] w-56 shrink-0 md:mx-0 md:w-64" />
        <div className="flex flex-1 flex-col justify-end">
          <Skeleton className="mb-4 h-10 w-3/4 md:h-12" />
          <div className="mb-4 flex gap-3">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-8 h-4 w-2/3" />
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-11 w-24 rounded-md" />
            <Skeleton className="h-11 w-28 rounded-md" />
            <Skeleton className="h-11 w-32 rounded-md" />
          </div>
        </div>
      </div>
    </section>
  );
}

export {
  Skeleton,
  PosterCardSkeleton,
  PosterRowSkeleton,
  PosterGridSkeleton,
  HeroBannerSkeleton,
  DetailPageSkeleton,
};
