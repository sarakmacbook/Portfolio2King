import { replay } from "./asset-replay";
import type { DatedTx } from "./daily-realized";
import type { PricePoint } from "./price-history";

export type DailyCryptoHolding = {
  id: number;
  symbol: string;
  provider: string;
  quantity: number;
  avgCost: number;
  price: number;
  /** Crypto category; stablecoins keep their saved price instead of live quotes. */
  cryptoCategory: "stablecoin" | "volatile";
  /** Unrealized P/L at the latest snapshot before today; null if unavailable. */
  openingUnrealized: number | null;
  /** A first-observed price was used because no earlier snapshot was available. */
  estimatedBaseline?: boolean;
};

/** Use the last available prior-day snapshot as an approximation of midnight. */
export function openingCryptoUnrealized(txs: readonly DatedTx[], snapshots: readonly PricePoint[], day: string, fallbackPrice?: number): number | null {
  const opening = replay("crypto", txs.filter((tx) => tx.date < day));
  if (opening.error) return null;
  if (opening.quantity === 0) return 0;
  const baseline = snapshots.filter((p) => p.date < day && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const price = baseline?.price ?? fallbackPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? opening.quantity * (price - opening.avgCost) : null;
}

/** Change in open P/L, added to booked P/L so sales are not counted twice. */
export function cryptoUnrealizedChange(holdings: readonly DailyCryptoHolding[], prices: Readonly<Record<number, number>> = {}): number {
  return holdings.reduce((sum, holding) => {
    if (holding.openingUnrealized === null) return sum;
    const price = prices[holding.id] ?? holding.price;
    if (holding.quantity !== 0 && (!Number.isFinite(price) || price <= 0)) return sum;
    return sum + holding.quantity * (price - holding.avgCost) - holding.openingUnrealized;
  }, 0);
}
