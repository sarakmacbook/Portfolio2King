/**
 * Pure helpers for the dashboard "Arrange" mode.
 *
 * The assets table can carry an explicit `sortOrder`; rows without one keep the
 * legacy type/name ordering. These helpers only deal with id lists so they are
 * easy to unit test (see tests/asset-order.test.ts).
 */

export type SortableAsset = { id: number; sortOrder: number | null };

/** Moves one entry to a new index, clamping out-of-range indexes. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (from === target) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Converts an HTML5 drag event's hovered row into a drop index.
 *
 * `after` means the pointer was in the lower half of the hovered row, so the
 * dragged row should land after it. Removing the dragged row first shifts the
 * index down when moving forward, which is what this accounts for.
 */
export function dropIndexFor(order: readonly number[], draggedId: number, overId: number, after: boolean): number {
  const from = order.indexOf(draggedId);
  const overIndex = order.indexOf(overId);
  if (from < 0 || overIndex < 0) return -1;
  let insertAt = overIndex + (after ? 1 : 0);
  if (insertAt > from) insertAt -= 1;
  return Math.max(0, Math.min(order.length - 1, insertAt));
}

/** Applies a drag-and-drop move to an id list. */
export function moveId(order: readonly number[], draggedId: number, overId: number, after: boolean): number[] {
  const index = dropIndexFor(order, draggedId, overId, after);
  if (index < 0) return [...order];
  return moveItem(order, order.indexOf(draggedId), index);
}

/**
 * Normalises a submitted order: keeps the submitted sequence, drops unknown and
 * duplicate ids, then appends every remaining asset in its previous order. This
 * keeps the save valid when another tab added or removed a holding meanwhile.
 */
export function mergeOrder(submitted: readonly number[], allIds: readonly number[]): number[] {
  const known = new Set(allIds);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of submitted) {
    if (!Number.isSafeInteger(id) || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  for (const id of allIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Next free position for a newly created asset, so it lands at the end. */
export function nextSortOrder(assets: readonly SortableAsset[]): number {
  let max = -1;
  for (const asset of assets) {
    if (typeof asset.sortOrder === "number" && asset.sortOrder > max) max = asset.sortOrder;
  }
  return max + 1;
}
