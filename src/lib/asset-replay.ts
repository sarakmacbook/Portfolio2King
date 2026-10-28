/**
 * Cost-basis replay: walk one asset's transactions in date order and work out
 * what is left (quantity, average cost) and what it has earned so far
 * (realised P/L from sells plus income from dividends and interest).
 *
 * Kept free of database imports so it can be unit-tested directly, and so the
 * daily P/L helpers (`daily-realized.ts`) can replay the same ledger twice and
 * subtract one answer from the other.
 */

import type { AssetType, TxKind } from "./constants";

/** Just the transaction fields the replay needs. */
export type ReplayTx = {
  kind: TxKind;
  quantity: number;
  price: number;
  fee?: number | null;
};

export type ReplayResult = {
  quantity: number;
  avgCost: number;
  realizedPnl: number;
  error?: string;
};

const EPS = 1e-9;

/** Replays transactions in chronological order to compute holdings. */
export function replay(type: AssetType, txs: ReplayTx[]): ReplayResult {
  let quantity = 0;
  let avgCost = type === "cash" ? 1 : 0;
  let realizedPnl = 0;

  for (const t of txs) {
    const fee = t.fee || 0;
    switch (t.kind) {
      case "buy":
      case "deposit": {
        if (type === "cash") {
          quantity += t.quantity;
          realizedPnl -= fee;
        } else {
          const newQty = quantity + t.quantity;
          avgCost = newQty > EPS ? (quantity * avgCost + t.quantity * t.price + fee) / newQty : 0;
          quantity = newQty;
        }
        break;
      }
      case "sell":
      case "withdraw": {
        if (t.quantity - quantity > EPS) {
          return {
            quantity,
            avgCost,
            realizedPnl,
            error: `Cannot ${t.kind} ${t.quantity} — only ${+quantity.toFixed(8)} available at that point.`,
          };
        }
        if (type === "cash") {
          quantity -= t.quantity;
          realizedPnl -= fee;
        } else {
          realizedPnl += t.quantity * (t.price - avgCost) - fee;
          quantity -= t.quantity;
          if (quantity < EPS) {
            quantity = 0;
            avgCost = 0;
          }
        }
        break;
      }
      case "dividend": {
        // Income: quantity = amount, price = 1
        const amount = t.quantity * t.price - fee;
        realizedPnl += amount;
        if (type === "cash") quantity += amount;
        break;
      }
    }
  }
  return { quantity, avgCost, realizedPnl };
}
