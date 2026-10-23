/**
 * The Holdings category tabs: which rows they match, which one is selected
 * (shared by the table and the value header through a tiny store), and the
 * order the tabs are arranged in.
 *
 * The ordering helpers are pure — see tests/holdings-categories.test.ts.
 */
import { isKeyOf, moveKeyBy, moveKeyTo, normaliseKeyOrder } from "@/lib/order-list";
import type { AssetType } from "@/lib/constants";

export type HoldingFilter = AssetType | "all" | "stablecoin" | "volatile";

export type FilterableHolding = {
  type: AssetType;
  cryptoCategory: "stablecoin" | "volatile";
  value: number;
  cost: number;
};

export const HOLDING_FILTERS: Array<{ value: HoldingFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "cash", label: "Cash" },
  { value: "stock", label: "Stocks" },
  { value: "stablecoin", label: "Stablecoins" },
  { value: "volatile", label: "Volatile crypto" },
  { value: "other", label: "Other" },
];

/** Every category key, in the default left-to-right order of the tab row. */
export const HOLDING_FILTER_KEYS: readonly HoldingFilter[] = HOLDING_FILTERS.map((item) => item.value);

/** "All" first, then cash, stocks, the two crypto buckets and other assets. */
export const DEFAULT_HOLDING_FILTER_ORDER: HoldingFilter[] = [...HOLDING_FILTER_KEYS];

export function isHoldingFilter(value: unknown): value is HoldingFilter {
  return isKeyOf(value, HOLDING_FILTER_KEYS);
}

/**
 * Accepts a stored value — comma string, JSON array, or array — and returns a
 * complete, duplicate-free, known-only category order.
 */
export function normaliseHoldingFilterOrder(value: unknown): HoldingFilter[] {
  return normaliseKeyOrder(value, HOLDING_FILTER_KEYS);
}

/** The category tabs (key + label) in a saved order, ready to render. */
export function orderHoldingFilters(
  order: readonly HoldingFilter[],
): Array<{ value: HoldingFilter; label: string }> {
  const labels = new Map(HOLDING_FILTERS.map((item) => [item.value, item.label]));
  return normaliseHoldingFilterOrder(order).map((value) => ({
    value,
    label: labels.get(value) ?? value,
  }));
}

/** Moves one category left (-1) or right (+1); clamped at the ends. */
export function moveHoldingFilterBy(
  order: readonly HoldingFilter[],
  key: HoldingFilter,
  delta: number,
): HoldingFilter[] {
  return moveKeyBy(order, key, delta);
}

/** Moves `key` so it lands before or after `overKey` (drag-and-drop). */
export function moveHoldingFilterTo(
  order: readonly HoldingFilter[],
  key: HoldingFilter,
  overKey: HoldingFilter,
  after: boolean,
): HoldingFilter[] {
  return moveKeyTo(order, key, overKey, after);
}

export function matchesHoldingFilter(
  row: Pick<FilterableHolding, "type" | "cryptoCategory">,
  filter: HoldingFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "stablecoin" || filter === "volatile") {
    return row.type === "crypto" && row.cryptoCategory === filter;
  }
  return row.type === filter;
}

export function filterHoldingsByCategory<
  T extends Pick<FilterableHolding, "type" | "cryptoCategory">,
>(rows: readonly T[], filter: HoldingFilter): T[] {
  return rows.filter((row) => matchesHoldingFilter(row, filter));
}

export function categoryTotalValue(
  rows: readonly Pick<FilterableHolding, "type" | "cryptoCategory" | "value">[],
  filter: HoldingFilter,
): number {
  return filterHoldingsByCategory(rows, filter).reduce((sum, row) => sum + row.value, 0);
}

export function categoryFilterLabel(filter: HoldingFilter): string {
  return HOLDING_FILTERS.find((item) => item.value === filter)?.label ?? "All";
}

let currentFilter: HoldingFilter = "all";
const listeners = new Set<() => void>();

export function getSelectedHoldingFilter(): HoldingFilter {
  return currentFilter;
}

export function setSelectedHoldingFilter(next: HoldingFilter): void {
  if (currentFilter === next) return;
  currentFilter = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeHoldingFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
