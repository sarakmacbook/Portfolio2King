import { isKeyOf, moveKeyBy, moveKeyTo, normaliseKeyOrder } from "@/lib/order-list";

/**
 * The four numbers at the top of the dashboard (Cash, cost basis, unrealised
 * and realised P/L). They can be shuffled left/right inside their row, renamed,
 * and the row itself is one of the movable dashboard blocks.
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
  realized: {
    label: "Today's realized P/L + income",
    hint: "Today's sells, dividends and interest — back to $0 at 12am",
  },
};

/** Default heading on each of the four stat cards. */
export const DEFAULT_DASHBOARD_STAT_LABELS: Record<DashboardStatKey, string> = {
  cash: DASHBOARD_STATS.cash.label,
  invested: DASHBOARD_STATS.invested.label,
  unrealized: DASHBOARD_STATS.unrealized.label,
  realized: DASHBOARD_STATS.realized.label,
};

/** Keeps a custom heading short enough to fit the stat card header. */
export const MAX_DASHBOARD_STAT_LABEL_LENGTH = 40;

/** Cash first, then the two P/L numbers, which is how the row has always read. */
export const DEFAULT_DASHBOARD_STAT_ORDER: DashboardStatKey[] = [...DASHBOARD_STAT_KEYS];

export function isDashboardStatKey(value: unknown): value is DashboardStatKey {
  return isKeyOf(value, DASHBOARD_STAT_KEYS);
}

export function normaliseDashboardStatOrder(value: unknown): DashboardStatKey[] {
  return normaliseKeyOrder(value, DASHBOARD_STAT_KEYS);
}

/**
 * Accepts a stored JSON object (or plain object) of custom stat labels and
 * returns a complete map. Blank or missing entries fall back to the default
 * label for that card; overlong strings are clipped to MAX_DASHBOARD_STAT_LABEL_LENGTH.
 */
export function normaliseDashboardStatLabels(
  value: unknown,
): Record<DashboardStatKey, string> {
  let raw: Record<string, unknown> = {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          raw = parsed as Record<string, unknown>;
        }
      } catch {
        raw = {};
      }
    }
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    raw = value as Record<string, unknown>;
  }

  const labels: Record<DashboardStatKey, string> = { ...DEFAULT_DASHBOARD_STAT_LABELS };
  for (const key of DASHBOARD_STAT_KEYS) {
    const candidate = raw[key];
    if (typeof candidate !== "string") continue;
    const cleaned = candidate.trim().slice(0, MAX_DASHBOARD_STAT_LABEL_LENGTH);
    if (cleaned.length > 0) {
      labels[key] = cleaned;
    }
  }
  return labels;
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
