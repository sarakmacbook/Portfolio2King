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
