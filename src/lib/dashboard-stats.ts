import { isKeyOf, moveKeyBy, moveKeyTo, normaliseKeyOrder } from "@/lib/order-list";

/**
 * The four numbers at the top of the dashboard (Cash, cost basis, unrealised
 * and realised P/L). They can be shuffled left/right inside their row, and the
 * row itself is one of the movable dashboard blocks.
 *
 * Pure helpers only — see tests/dashboard-layout.test.ts.
 */

export const DASHBOARD_STAT_KEYS = ["cash", "invested", "unrealized", "realized"] as const;

export type DashboardStatKey = (typeof DASHBOARD_STAT_KEYS)[number];

export type DashboardStatMeta = { label: string; hint: string };

export const DASHBOARD_STATS: Record<DashboardStatKey, DashboardStatMeta> = {
  cash: { label: "Cash", hint: "Cash balance" },
  invested: { label: "Invested (cost basis)", hint: "What the open positions cost" },
  unrealized: { label: "Unrealized P/L", hint: "Open profit and loss" },
  realized: { label: "Realized P/L + income", hint: "Sells, dividends and interest" },
};

/** Cash first, then the two P/L numbers, which is how the row has always read. */
export const DEFAULT_DASHBOARD_STAT_ORDER: DashboardStatKey[] = [...DASHBOARD_STAT_KEYS];

export function isDashboardStatKey(value: unknown): value is DashboardStatKey {
  return isKeyOf(value, DASHBOARD_STAT_KEYS);
}

export function normaliseDashboardStatOrder(value: unknown): DashboardStatKey[] {
  return normaliseKeyOrder(value, DASHBOARD_STAT_KEYS);
}

/** Moves one card left (-1) or right (+1); clamped at the ends. */
export function moveStatBy(
  order: readonly DashboardStatKey[],
  key: DashboardStatKey,
  delta: number,
): DashboardStatKey[] {
  return moveKeyBy(order, key, delta);
}

/** Moves `key` so it lands before or after `overKey` (drag-and-drop). */
export function moveStatTo(
  order: readonly DashboardStatKey[],
  key: DashboardStatKey,
  overKey: DashboardStatKey,
  after: boolean,
): DashboardStatKey[] {
  return moveKeyTo(order, key, overKey, after);
}
