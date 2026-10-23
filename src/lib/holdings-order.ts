/**
 * The order of the asset rows inside the Holdings card.
 *
 * The dashboard's "Arrange layout" mode lets a holding be dragged (or nudged
 * with ▲ / ▼) above or below another one, and **Save layout** stores that order
 * in `app_settings` under `holdings.order` as a comma-separated list of asset
 * ids, next to the card order and the category-tab order.
 *
 * Only ids are stored: the row itself keeps coming from the database, so a
 * deleted holding simply disappears from the saved order and a new holding is
 * appended at the end. Pure helpers only — see tests/holdings-order.test.ts.
 */
import { insertAt } from "@/lib/order-list";

export type OrderableHolding = { id: number };

/**
 * Accepts a stored value — comma string, JSON array, or array — and returns the
 * asset ids it mentions, in order, without duplicates or non-positive values.
 */
export function parseHoldingOrderIds(value: unknown): number[] {
  let parts: unknown[] = [];
  if (Array.isArray(value)) {
    parts = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        parts = Array.isArray(parsed) ? parsed : [];
      } catch {
        parts = [];
      }
    } else if (trimmed) {
      parts = trimmed.split(",");
    }
  }

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const part of parts) {
    const id = typeof part === "number" ? part : Number(String(part).trim());
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The complete row order: the saved ids that still exist, in their saved order,
 * followed by every holding the saved order does not mention (new assets) in the
 * order they arrived in. A stale or hand-edited setting can never hide a row.
 */
export function normaliseHoldingOrder(
  value: unknown,
  currentIds: readonly number[],
): number[] {
  const current = new Set<number>();
  for (const id of currentIds) {
    if (Number.isInteger(id) && id > 0) current.add(id);
  }

  const seen = new Set<number>();
  const order: number[] = [];
  for (const id of parseHoldingOrderIds(value)) {
    if (!current.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const id of currentIds) {
    if (!current.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/** True when a saved order exists — i.e. the rows are arranged by hand. */
export function hasHoldingOrder(value: unknown): boolean {
  return parseHoldingOrderIds(value).length > 0;
}

/** Moves one holding up (-1) or down (+1); clamped at both ends. */
export function moveHoldingBy(
  order: readonly number[],
  id: number,
  delta: number,
): number[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  return insertAt(order, from, to);
}

/** Moves `id` so it lands before or after `overId` (drag-and-drop). */
export function moveHoldingTo(
  order: readonly number[],
  id: number,
  overId: number,
  after: boolean,
): number[] {
  const from = order.indexOf(id);
  const overIndex = order.indexOf(overId);
  if (from < 0 || overIndex < 0 || from === overIndex) return [...order];
  let target = overIndex + (after ? 1 : 0);
  if (target > from) target -= 1;
  return insertAt(order, from, target);
}

/**
 * `rows` re-ordered to match `order`. Rows the order does not mention keep their
 * relative position at the end, so filtering one category or a saved order that
 * predates a new holding both behave sensibly. The input is never mutated.
 */
export function applyHoldingOrder<T extends OrderableHolding>(
  rows: readonly T[],
  order: readonly number[],
): T[] {
  if (order.length === 0) return [...rows];
  const byId = new Map<number, T>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }

  const result: T[] = [];
  for (const id of order) {
    const row = byId.get(id);
    if (!row) continue;
    byId.delete(id);
    result.push(row);
  }
  for (const row of rows) {
    if (byId.delete(row.id)) result.push(row);
  }
  return result;
}
