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
