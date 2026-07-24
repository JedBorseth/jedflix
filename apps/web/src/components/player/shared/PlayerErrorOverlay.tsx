import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type PlayerErrorOverlayProps = {
  title?: string;
  message: string;
  onRetryStreams?: () => void;
  backPath?: string;
  backLabel?: string;
  homePath?: string;
  homeLabel?: string;
  children?: ReactNode;
};

export function PlayerErrorOverlay({
  title = "Unable to play stream",
  message,
  onRetryStreams,
  backPath,
  backLabel = "Back to title",
  homePath = "/",
  homeLabel = "Return home",
  children,
}: PlayerErrorOverlayProps) {
  return (
    <div className="player-error">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="max-w-lg text-zinc-300">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetryStreams ? (
          <Button type="button" onClick={onRetryStreams}>
            Pick another stream
          </Button>
        ) : null}
        {backPath ? (
          <Button asChild variant="outline">
            <Link to={backPath}>{backLabel}</Link>
          </Button>
        ) : null}
        {homePath ? (
          <Button asChild variant="outline">
            <Link to={homePath}>{homeLabel}</Link>
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
