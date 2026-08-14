/** Reorder a list by moving an item from one index to another. */
export function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }
  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) {
    return items;
  }
  next.splice(toIndex, 0, item);
  return next;
}

/**
 * After moving an item from `fromIndex` to `toIndex`, return the new index
 * of whatever was previously at `currentIndex`.
 */
export function remapIndexAfterReorder(
  currentIndex: number,
  fromIndex: number,
  toIndex: number,
): number {
  if (fromIndex === toIndex) {
    return currentIndex;
  }
  if (currentIndex === fromIndex) {
    return toIndex;
  }
  if (fromIndex < currentIndex && toIndex >= currentIndex) {
    return currentIndex - 1;
  }
  if (fromIndex > currentIndex && toIndex <= currentIndex) {
    return currentIndex + 1;
  }
  return currentIndex;
}

/**
 * Move a previewed Infinite Queue track onto the playable queue (end)
 * and drop it from the recommendation list.
 */
export function promoteRecommendationToQueue<T extends { id: string }>(
  queue: T[],
  recommendations: T[],
  trackId: string,
): { queue: T[]; recommendations: T[]; promoted: T | null } {
  const promoted = recommendations.find((track) => track.id === trackId) ?? null;
  if (!promoted) {
    return { queue, recommendations, promoted: null };
  }
  const alreadyQueued = queue.some((track) => track.id === trackId);
  return {
    queue: alreadyQueued ? queue : [...queue, promoted],
    recommendations: recommendations.filter((track) => track.id !== trackId),
    promoted,
  };
}

/** Insert `track` immediately after the currently playing index. */
export function insertPlayNext<T>(queue: T[], currentIndex: number, track: T): T[] {
  const next = queue.slice();
  const insertAt = Math.min(Math.max(currentIndex + 1, 0), next.length);
  next.splice(insertAt, 0, track);
  return next;
}

/** Compute drop index from vertical drag distance and fixed row height. */
export function dropIndexFromDrag(
  fromIndex: number,
  movementY: number,
  rowHeight: number,
  queueLength: number,
): number {
  if (rowHeight <= 0 || queueLength <= 0) {
    return fromIndex;
  }
  const delta = Math.round(movementY / rowHeight);
  return Math.max(0, Math.min(queueLength - 1, fromIndex + delta));
}
