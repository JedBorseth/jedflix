import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@/lib/types";

type MockVideoPlayerProps = {
  movieId: number;
  mediaType: MediaType;
  title: string;
  durationMinutes: number;
};

export function MockVideoPlayer({
  movieId,
  mediaType,
  title,
  durationMinutes,
}: MockVideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [progressSeconds, setProgressSeconds] = useState(0);
  const upsertProgress = useMutation(api.watchHistory.upsertProgress);

  const totalSeconds = durationMinutes * 60;
  const progressPercent = Math.min((progressSeconds / totalSeconds) * 100, 100);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = window.setInterval(() => {
      setProgressSeconds((current) => {
        const next = Math.min(current + 1, totalSeconds);
        return next;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isPlaying, totalSeconds]);

  useEffect(() => {
    if (progressSeconds > 0 && progressSeconds % 10 === 0) {
      void upsertProgress({ movieId, mediaType, progressSeconds }).catch(() => {
        // Progress saving requires auth; ignore for guests.
      });
    }
  }, [mediaType, movieId, progressSeconds, upsertProgress]);

  return (
    <div className="relative flex min-h-screen flex-col bg-black text-white">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-3">
        <Button asChild variant="ghost" className="text-white hover:bg-white/10">
          <Link to={mediaType === "movie" ? `/movie/${movieId}` : `/show/${movieId}`}>
            &larr; Back
          </Link>
        </Button>
        <span className="text-sm text-zinc-400">Demo playback</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="mb-6 rounded-full border border-zinc-700 px-4 py-1 text-xs uppercase tracking-widest text-zinc-400">
          Mock stream — no video file
        </div>
        <h1 className="mb-2 text-center text-3xl font-bold md:text-5xl">{title}</h1>
        <p className="mb-8 text-center text-zinc-400">
          Simulated playback for the Netflix-style UI scaffold
        </p>

        <Button
          size="lg"
          className="bg-red-600 hover:bg-red-700"
          onClick={() => setIsPlaying((playing) => !playing)}
        >
          {isPlaying ? "Pause" : "Play"}
        </Button>

        <Authenticated>
          <p className="mt-4 text-sm text-zinc-500">
            Watch progress saves every 10 seconds while signed in.
          </p>
        </Authenticated>
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950/90 px-4 py-4 md:px-8">
        <div className="mb-2 flex justify-between text-xs text-zinc-400">
          <span>
            {formatTime(progressSeconds)} / {formatTime(totalSeconds)}
          </span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-red-600 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
