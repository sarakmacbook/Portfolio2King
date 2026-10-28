/**
 * The dashboard's "Today's realized P/L + income" card, as *today's* number.
 *
 * The dashboard card used to show the all-time figure, which only ever grows and
 * so says nothing about how today went. This module slices the ledger at the
 * start of the current day: the realised total as of yesterday is subtracted
 * from the realised total now, leaving only what was booked since 12am.
 *
 * The day rolls over at local midnight — see `dayKeyInTimeZone()`, which uses
 * the same timezone the portfolio alerts are scheduled in (falling back to the
 * server's zone).
 *
 * Pure functions only — see tests/daily-realized.test.ts.
 */

import { resolveTimeZone, zonedClock } from "./alert-rules";
import { replay } from "./asset-replay";
import type { AssetType, TxKind } from "./constants";

/** A transaction dated `YYYY-MM-DD`, which is how the `date` column reads. */
export type DatedTx = {
  kind: TxKind;
  quantity: number;
  price: number;
  fee?: number | null;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
};

export type DayRealized = {
  /** Sells plus income booked since 12am — the number on the card. */
  total: number;
  /** The part that came from sells (and cash moves, net of fees). */
  trades: number;
  /** The part that came from dividends / interest, minus fees. */
  income: number;
  /** How many transactions of this asset fall on/after the day boundary. */
  count: number;
};

export const EMPTY_DAY_REALIZED: DayRealized = { total: 0, trades: 0, income: 0, count: 0 };

/** Float noise from averaging costs must not turn into a 1e-15 P/L line. */
function clean(n: number): number {
  return Math.abs(n) < 1e-8 ? 0 : n;
}

/** `YYYY-MM-DD` for an instant in a timezone; the date the day resets on. */
export function dayKeyInTimeZone(instant: Date, timeZone?: string | null): string {
  const zone = resolveTimeZone(timeZone);
  try {
    return zonedClock(instant, zone).date;
  } catch {
    // A zone the runtime cannot format should never break the dashboard.
    const tz = instant.getTimezoneOffset() * 60000;
    return new Date(instant.getTime() - tz).toISOString().slice(0, 10);
  }
}

/**
 * Today's realised P/L and income for one asset.
 *
 * Replaying the ledger twice — everything, and everything before `day` — is what
 * makes this correct for partial sells: the average cost at the time of each
 * sell is whatever it was on that date, so yesterday's buys are not re-costed.
 */
export function realizedOnDay(
  type: AssetType,
  txs: readonly DatedTx[],
  day: string,
): DayRealized {
  const today = txs.filter((tx) => tx.date >= day);
  if (today.length === 0) return { ...EMPTY_DAY_REALIZED };

  const all = replay(type, txs as DatedTx[]);
  const before = replay(
    type,
    txs.filter((tx) => tx.date < day),
  );
  const total = clean(all.realizedPnl - before.realizedPnl);

  let income = 0;
  for (const tx of today) {
    if (tx.kind !== "dividend") continue;
    income += tx.quantity * tx.price - (tx.fee || 0);
  }
  income = clean(income);

  return { total, trades: clean(total - income), income, count: today.length };
}

/** Adds up per-asset results, so the card can show one portfolio number. */
export function sumDayRealized(parts: readonly DayRealized[]): DayRealized {
  const total: DayRealized = { ...EMPTY_DAY_REALIZED };
  for (const part of parts) {
    total.total = clean(total.total + part.total);
    total.trades = clean(total.trades + part.trades);
    total.income = clean(total.income + part.income);
    total.count += part.count;
  }
  return total;
}

/** Groups dated transactions by asset so `realizedOnDay` can run per asset. */
export function groupTxsByAsset<T extends DatedTx & { assetId: number }>(
  rows: readonly T[],
): Map<number, T[]> {
  const byAsset = new Map<number, T[]>();
  for (const row of rows) {
    const list = byAsset.get(row.assetId);
    if (list) list.push(row);
    else byAsset.set(row.assetId, [row]);
  }
  return byAsset;
}
