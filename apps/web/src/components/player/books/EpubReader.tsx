import { useEffect, useRef } from "react";
import ePub from "epubjs";

type EpubReaderProps = {
  streamUrl: string;
  initialLocation?: string;
  onLocationChange?: (location: string) => void;
};

export function EpubReader({ streamUrl, initialLocation, onLocationChange }: EpubReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const book = ePub(streamUrl, { openAs: "epub" });
    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      flow: "paginated",
    });

    void rendition.display(initialLocation || undefined);

    const onRelocated = (location: { start?: { cfi?: string } }) => {
      const cfi = location?.start?.cfi;
      if (cfi) {
        onLocationChange?.(cfi);
      }
    };
    rendition.on("relocated", onRelocated);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        void rendition.next();
      } else if (event.key === "ArrowLeft") {
        void rendition.prev();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      rendition.off("relocated", onRelocated);
      book.destroy();
    };
  }, [streamUrl, initialLocation, onLocationChange]);

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="min-h-[70vh] rounded-lg border border-zinc-800 bg-zinc-100 text-black"
      />
      <p className="text-sm text-zinc-500">
        Use arrow keys to turn pages. Progress saves automatically while signed in.
      </p>
    </div>
  );
}
