import { isKeyOf, moveKeyBy, moveKeyTo, normaliseKeyOrder } from "@/lib/order-list";

/**
 * Top-level dashboard cards. The order is stored in `app_settings` under
 * `dashboard.order` and edited in the dashboard "Arrange layout" mode.
 *
 * Pure helpers only — see tests/dashboard-layout.test.ts.
 */

export const DASHBOARD_BLOCK_KEYS = ["stats", "holdings", "history", "allocation", "activity"] as const;

export type DashboardBlockKey = (typeof DASHBOARD_BLOCK_KEYS)[number];

export type DashboardBlockMeta = { label: string; hint: string };

export const DASHBOARD_BLOCKS: Record<DashboardBlockKey, DashboardBlockMeta> = {
  stats: { label: "Portfolio stats", hint: "Cash, cost basis and P/L — shuffle the four cards inside" },
  holdings: { label: "Holdings", hint: "Table of every position" },
  history: { label: "Value history", hint: "Portfolio value over time" },
  allocation: { label: "Allocation", hint: "Breakdown by category" },
  activity: { label: "Recent activity", hint: "Latest transactions" },
};

/** The stat row first, then the table, the two charts and the activity feed. */
export const DEFAULT_DASHBOARD_ORDER: DashboardBlockKey[] = [...DASHBOARD_BLOCK_KEYS];

export function isDashboardBlockKey(value: unknown): value is DashboardBlockKey {
  return isKeyOf(value, DASHBOARD_BLOCK_KEYS);
}

export function normaliseDashboardOrder(value: unknown): DashboardBlockKey[] {
  const order = normaliseKeyOrder(value, DASHBOARD_BLOCK_KEYS);
  // The stat row became a block later than the rest, so an order saved before
  // that has no "stats" and would otherwise collect it at the bottom. It has
  // always been displayed at the top, so keep it there.
  const mentionsStats = Array.isArray(value)
    ? value.some((key) => key === "stats")
    : typeof value === "string" && value.includes("stats");
  if (mentionsStats) return order;
  return ["stats", ...order.filter((key) => key !== "stats")];
}

/** Moves one card up (-1) or down (+1); clamped at the ends. */
export function moveBlockBy(
  order: readonly DashboardBlockKey[],
  key: DashboardBlockKey,
  delta: number,
): DashboardBlockKey[] {
  return moveKeyBy(order, key, delta);
}

/** Moves `key` so it lands before or after `overKey` (drag-and-drop). */
export function moveBlockTo(
  order: readonly DashboardBlockKey[],
  key: DashboardBlockKey,
  overKey: DashboardBlockKey,
  after: boolean,
): DashboardBlockKey[] {
  return moveKeyTo(order, key, overKey, after);
}
