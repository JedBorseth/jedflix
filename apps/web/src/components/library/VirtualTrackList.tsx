import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const DEFAULT_ROW_HEIGHT = 64;
/** Clears fixed mini-player + bottom nav so the last rows stay tappable. */
const CHROME_PADDING_END = 160;

type Props<T> = {
  items: T[];
  /** Called when the user (or auto-load) approaches the end. */
  onNearEnd?: () => void;
  estimateSize?: number;
  className?: string;
  /** Absolute/viewport height class — defaults to filling remaining page space. */
  heightClassName?: string;
  getItemKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
};

/**
 * Windowed list for playlists / liked songs with thousands of rows.
 * Only mounts DOM for visible rows (+ overscan).
 */
export function VirtualTrackList<T>({
  items,
  onNearEnd,
  estimateSize = DEFAULT_ROW_HEIGHT,
  className,
  heightClassName = "h-[calc(100dvh-13rem)] md:h-[min(70vh,720px)]",
  getItemKey,
  renderRow,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const nearEndSent = useRef(false);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 12,
    paddingEnd: CHROME_PADDING_END,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (!onNearEnd || items.length === 0) {
      return;
    }
    const last = virtualItems[virtualItems.length - 1];
    if (!last) {
      return;
    }
    if (last.index >= items.length - 20) {
      if (!nearEndSent.current) {
        nearEndSent.current = true;
        onNearEnd();
      }
    } else {
      nearEndSent.current = false;
    }
  }, [virtualItems, items.length, onNearEnd]);

  // Reset near-end latch when more items arrive so further pages can load.
  useEffect(() => {
    nearEndSent.current = false;
  }, [items.length]);

  return (
    <div
      ref={parentRef}
      className={`${heightClassName} overflow-y-auto ${className ?? ""}`}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) {
            return null;
          }
          return (
            <div
              key={getItemKey(item, virtualRow.index)}
              className="absolute left-0 top-0 w-full"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderRow(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
