import { TYPE_META } from "@/lib/format";
import type { AssetType } from "@/lib/constants";
import { insertAt, isKeyOf, moveKeyBy, moveKeyTo, normaliseKeyOrder } from "@/lib/order-list";

/**
 * Category groups for the dashboard holdings table.
 *
 * The table is rendered as sections (Cash, Stocks, Crypto · Stablecoin,
 * Crypto · Volatile, Other). Each section can be moved up or down as a whole in
 * "Arrange" mode, and rows can still be reordered inside their section.
 *
 * Pure helpers only — see tests/holdings-groups.test.ts.
 */

export const HOLDING_GROUP_KEYS = [
  "cash",
  "stock",
  "crypto-stablecoin",
  "crypto-volatile",
  "other",
] as const;

export type HoldingGroupKey = (typeof HOLDING_GROUP_KEYS)[number];

export type GroupMeta = { label: string; short: string; color: string };

export const HOLDING_GROUPS: Record<HoldingGroupKey, GroupMeta> = {
  cash: { label: "Cash", short: "Cash", color: TYPE_META.cash.color },
  stock: { label: "Stocks", short: "Stocks", color: TYPE_META.stock.color },
  "crypto-stablecoin": { label: "Crypto · Stablecoin", short: "Stablecoins", color: "#14b8a6" },
  "crypto-volatile": { label: "Crypto · Volatile", short: "Volatile crypto", color: TYPE_META.crypto.color },
  other: { label: "Other", short: "Other", color: TYPE_META.other.color },
};

/** Cash first, then equities, then crypto, then everything else. */
export const DEFAULT_GROUP_ORDER: HoldingGroupKey[] = [...HOLDING_GROUP_KEYS];

export function isHoldingGroupKey(value: unknown): value is HoldingGroupKey {
  return isKeyOf(value, HOLDING_GROUP_KEYS);
}

export type GroupableHolding = { type: AssetType; cryptoCategory: "stablecoin" | "volatile" };

/** Which section a holding belongs to. */
export function groupKeyFor(row: GroupableHolding): HoldingGroupKey {
  if (row.type === "crypto") {
    return row.cryptoCategory === "stablecoin" ? "crypto-stablecoin" : "crypto-volatile";
  }
  if (row.type === "cash" || row.type === "stock" || row.type === "other") return row.type;
  return "other";
}

/**
 * Accepts a stored value (comma string, JSON array, or array) and returns a
 * complete, duplicate-free order: unknown keys are dropped and any missing group
 * is appended in its default position.
 */
export function normaliseGroupOrder(value: unknown): HoldingGroupKey[] {
  return normaliseKeyOrder(value, HOLDING_GROUP_KEYS);
}

/** Moves one group up (-1) or down (+1); clamped at the ends. */
export function moveGroupBy(
  order: readonly HoldingGroupKey[],
  key: HoldingGroupKey,
  delta: number,
): HoldingGroupKey[] {
  return moveKeyBy(order, key, delta);
}

/** Moves `key` so it lands before or after `overKey` (drag-and-drop). */
export function moveGroupTo(
  order: readonly HoldingGroupKey[],
  key: HoldingGroupKey,
  overKey: HoldingGroupKey,
  after: boolean,
): HoldingGroupKey[] {
  return moveKeyTo(order, key, overKey, after);
}

export type HoldingSection<T> = { key: HoldingGroupKey; meta: GroupMeta; rows: T[] };

/**
 * Buckets rows into sections following `order`, keeping each section's rows in
 * their incoming order. Empty sections are omitted so the table has no gaps.
 */
export function groupSections<T extends GroupableHolding>(
  rows: readonly T[],
  order: readonly HoldingGroupKey[],
): Array<HoldingSection<T>> {
  const buckets = new Map<HoldingGroupKey, T[]>();
  for (const key of normaliseGroupOrder(order)) buckets.set(key, []);
  for (const row of rows) {
    const key = groupKeyFor(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const sections: Array<HoldingSection<T>> = [];
  for (const [key, groupRows] of buckets) {
    if (groupRows.length === 0) continue;
    sections.push({ key, meta: HOLDING_GROUPS[key], rows: groupRows });
  }
  return sections;
}

/** Flattens sections back into the single list that is persisted. */
export function flattenSections<T>(sections: ReadonlyArray<{ rows: readonly T[] }>): T[] {
  return sections.flatMap((section) => [...section.rows]);
}

/**
 * Reorders a row inside its own section. Drops onto rows of another category are
 * ignored — moving an asset between categories is a data change, not a reorder.
 * Positions of other sections are preserved exactly.
 */
export function moveRowWithinGroup<T extends GroupableHolding & { id: number }>(
  order: readonly number[],
  rows: readonly T[],
  draggedId: number,
  overId: number,
  after: boolean,
): number[] {
  const groupById = new Map(rows.map((row) => [row.id, groupKeyFor(row)] as const));
  const draggedGroup = groupById.get(draggedId);
  const overGroup = groupById.get(overId);
  if (!draggedGroup || draggedGroup !== overGroup) return [...order];

  const groupIds = order.filter((id) => groupById.get(id) === draggedGroup);
  const from = groupIds.indexOf(draggedId);
  const overIndex = groupIds.indexOf(overId);
  if (from < 0 || overIndex < 0) return [...order];
  let target = overIndex + (after ? 1 : 0);
  if (target > from) target -= 1;
  if (target === from) return [...order];
  const moved = insertAt(groupIds, from, target);

  const slots: number[] = [];
  order.forEach((id, index) => {
    if (groupById.get(id) === draggedGroup) slots.push(index);
  });
  const next = [...order];
  slots.forEach((slot, index) => {
    next[slot] = moved[index];
  });
  return next;
}
