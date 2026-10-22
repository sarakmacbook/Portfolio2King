export type PricePoint = {
  date: string;
  price: number;
};

export type DailyPriceRow = {
  date: string;
  price: number;
  prevPrice: number | null;
  change: number | null;
  changePct: number | null;
};

export type PriceHistoryRange = "1M" | "6M" | "1Y" | "ALL";

export const PRICE_HISTORY_RANGES: Array<{ value: PriceHistoryRange; label: string; months?: number }> = [
  { value: "1M", label: "1 month", months: 1 },
  { value: "6M", label: "6 months", months: 6 },
  { value: "1Y", label: "1 year", months: 12 },
  { value: "ALL", label: "All time" },
];

/**
 * Normalizes daily asset price snapshots into a strictly ascending series
 * with at most one snapshot per calendar date, including today's live price.
 */
export function buildAssetPriceSeries(
  snapshots: ReadonlyArray<PricePoint>,
  currentPrice?: number,
  currentDate?: string,
): PricePoint[] {
  const byDate = new Map<string, number>();
  for (const row of snapshots) {
    if (row.date && Number.isFinite(row.price) && row.price > 0) {
      byDate.set(row.date, row.price);
    }
  }
  if (currentDate && typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0) {
    const dates = Array.from(byDate.keys()).sort();
    const latest = dates[dates.length - 1];
    if (!latest || currentDate >= latest) {
      byDate.set(currentDate, currentPrice);
    }
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, price]) => ({ date, price }));
}

/**
 * Computes day-over-day price deltas from daily snapshots, ordered newest first
 * so the most recent daily snapshot prices appear at the top of tables.
 */
export function computeDailyPriceRows(series: ReadonlyArray<PricePoint>): DailyPriceRow[] {
  const asc = [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rows: DailyPriceRow[] = asc.map((point, index) => {
    const prev = index > 0 ? asc[index - 1] : null;
    const prevPrice = prev ? prev.price : null;
    const change = prevPrice !== null ? point.price - prevPrice : null;
    const changePct = prevPrice && prevPrice > 0 ? (point.price - prevPrice) / prevPrice : null;
    return {
      date: point.date,
      price: point.price,
      prevPrice,
      change,
      changePct,
    };
  });
  return rows.reverse();
}

/**
 * Returns the latest day-over-day change relative to the most recent prior snapshot date.
 */
export function latestDailyPriceChange(series: ReadonlyArray<PricePoint>): {
  change: number;
  changePct: number;
  prevDate: string;
  prevPrice: number;
} | null {
  if (series.length < 2) return null;
  const asc = [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = asc[asc.length - 1];
  const prev = asc[asc.length - 2];
  if (!prev || prev.price <= 0) return null;
  const change = latest.price - prev.price;
  return {
    change,
    changePct: change / prev.price,
    prevDate: prev.date,
    prevPrice: prev.price,
  };
}

/**
 * Filters ascending price points to the selected history window anchored to the latest point.
 */
export function filterPricePointsByRange(
  points: ReadonlyArray<PricePoint>,
  range: PriceHistoryRange,
): PricePoint[] {
  const selected = PRICE_HISTORY_RANGES.find((item) => item.value === range);
  if (!selected?.months || points.length === 0) return [...points];
  const latest = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  const cutoff = new Date(latest);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - selected.months);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const filtered = points.filter((point) => point.date >= cutoffDate);
  return filtered.length > 0 ? filtered : [points[points.length - 1]];
}
