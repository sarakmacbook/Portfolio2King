import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, exchangeBalances, transactions } from "@/db/schema";
import { clearExchangeCredentials, getExchangeCredentials } from "@/lib/exchange-credentials";
import {
  EXCHANGE_LABELS,
  fetchExchangeBalances,
  roundQuantity,
  type ExchangeBalanceRow,
  type ExchangeId,
} from "@/lib/exchanges";
import { fetchPreferredMarketPrice } from "@/lib/market-prices";
import { ensureSchema, recomputeAsset, recordSnapshot, today } from "@/lib/portfolio";

/**
 * Turns exchange balances into portfolio holdings.
 *
 * The portfolio stays transaction-driven: a sync does not overwrite an asset's
 * quantity, it books the *difference* for that exchange as a deposit or a
 * withdrawal. So manual trades keep their cost basis, two exchanges holding the
 * same coin add up correctly, and Activity shows what the import actually did.
 * `exchange_balances` remembers the last figure per (asset, exchange), which is
 * what makes the next sync a difference rather than a duplicate.
 *
 * A coin reported by the exchange and unknown to the portfolio is created as a
 * crypto holding pinned to that exchange for pricing.
 */

const DUST = 1e-10;

/** Coins shown as stablecoins rather than volatile when auto-created. */
const STABLECOINS = new Set(["USDT", "USDC", "DAI", "TUSD", "FDUSD", "USDD", "PYUSD", "USD1", "USDE"]);

export type ExchangeSyncChange = {
  symbol: string;
  /** Units added (positive) or removed (negative) from the holding. */
  delta: number;
  /** "deposit" | "withdraw" — what was written to Activity. */
  kind: "deposit" | "withdraw";
  /** True when the asset was created by this sync. */
  created: boolean;
};

export type ExchangeSyncResult = {
  exchange: ExchangeId;
  label: string;
  syncedAt: string;
  /** Number of currencies the exchange reported (after dust removal). */
  reported: number;
  changes: ExchangeSyncChange[];
  /** Currencies that stopped appearing on the exchange and were removed. */
  closed: string[];
  /** Non-fatal problems, e.g. no market price for a brand-new coin. */
  warnings: string[];
};

export type ExchangeHolding = {
  exchange: ExchangeId;
  symbol: string;
  assetId: number;
  name: string;
  quantity: number;
  price: number;
  value: number;
  syncedAt: string;
};

/** Every imported position, for the exchange page. */
export async function listExchangeHoldings(): Promise<ExchangeHolding[]> {
  await ensureSchema();
  const rows = await db
    .select({
      exchange: exchangeBalances.exchange,
      symbol: exchangeBalances.symbol,
      assetId: exchangeBalances.assetId,
      quantity: exchangeBalances.quantity,
      syncedAt: exchangeBalances.syncedAt,
      name: assets.name,
      assetSymbol: assets.symbol,
      price: assets.currentPrice,
    })
    .from(exchangeBalances)
    .innerJoin(assets, eq(assets.id, exchangeBalances.assetId));

  return rows
    .map((row) => ({
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol || row.assetSymbol,
      assetId: row.assetId,
      name: row.name,
      quantity: row.quantity,
      price: row.price,
      value: row.quantity * row.price,
      syncedAt: row.syncedAt.toISOString(),
    }))
    .sort((a, b) => b.value - a.value);
}

/** Most recent sync per exchange, for "synced … ago" labels. */
export async function lastExchangeSync(): Promise<Partial<Record<ExchangeId, string>>> {
  await ensureSchema();
  const rows = await db
    .select({ exchange: exchangeBalances.exchange, syncedAt: sql<Date>`max(${exchangeBalances.syncedAt})` })
    .from(exchangeBalances)
    .groupBy(exchangeBalances.exchange);
  return Object.fromEntries(rows.map((row) => [row.exchange, new Date(row.syncedAt).toISOString()]));
}

async function findCryptoAsset(symbol: string) {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.type, "crypto"), sql`upper(${assets.symbol}) = ${symbol}`))
    .orderBy(asc(assets.id))
    .limit(1);
  return asset ?? null;
}

/**
 * Creates the holding row for a coin seen for the first time. The price is
 * best-effort: if no provider answers, the asset is still created and the price
 * arrives with the next "Refresh prices" instead of failing the whole sync.
 */
async function createCryptoAsset(exchange: ExchangeId, row: ExchangeBalanceRow, warnings: string[]) {
  let price = 0;
  try {
    price = (await fetchPreferredMarketPrice(exchange, row.symbol)).price;
  } catch {
    warnings.push(`Created ${row.symbol} without a price — refresh prices to value it.`);
  }
  const [created] = await db
    .insert(assets)
    .values({
      type: "crypto",
      name: row.symbol,
      symbol: row.symbol,
      cryptoCategory: STABLECOINS.has(row.symbol) ? "stablecoin" : "volatile",
      priceSource: exchange,
      currentPrice: Number.isFinite(price) && price > 0 ? price : 0,
      notes: `Imported from ${EXCHANGE_LABELS[exchange]}`,
    })
    .returning();
  return created;
}

/** Books one change against a holding, clamped so a withdrawal cannot go negative. */
async function bookChange(
  assetId: number,
  kind: "deposit" | "withdraw",
  requested: number,
  price: number,
  exchange: ExchangeId,
  warnings: string[],
): Promise<number> {
  if (requested <= DUST) return 0;
  let quantity = roundQuantity(requested);

  if (kind === "withdraw") {
    const [asset] = await db.select({ quantity: assets.quantity }).from(assets).where(eq(assets.id, assetId));
    const available = asset?.quantity ?? 0;
    if (available < quantity) {
      // Exchange reports less than the portfolio holds: remove what exists and
      // keep the rest, which is what a manual sale recorded elsewhere looks like.
      warnings.push(
        `Only ${formatQty(available)} of the reported change could be removed — check manual transactions for this coin.`,
      );
      quantity = roundQuantity(Math.max(0, available));
    }
  }
  if (quantity <= DUST) return 0;

  await db.insert(transactions).values({
    assetId,
    kind,
    quantity,
    price: Math.max(0, price),
    fee: 0,
    date: today(),
    note: `${kind === "deposit" ? "Imported from" : "Removed from"} ${EXCHANGE_LABELS[exchange]}`,
  });
  return quantity;
}

function formatQty(value: number): string {
  return String(roundQuantity(value));
}

/**
 * Fetches balances and applies them. Throws `ExchangeApiError` on a bad key, so
 * the caller can show the exchange's own complaint instead of a generic error.
 */
export async function syncExchange(
  exchange: ExchangeId,
  now = Date.now(),
  /** Balances already fetched (connect verifies first, then imports them). */
  prefetched?: ExchangeBalanceRow[],
): Promise<ExchangeSyncResult> {
  await ensureSchema();
  const credentials = await getExchangeCredentials(exchange);
  if (!credentials) {
    throw new Error(`No ${EXCHANGE_LABELS[exchange]} API key saved yet.`);
  }

  const reported = prefetched ?? (await fetchExchangeBalances(exchange, credentials, now));
  const label = EXCHANGE_LABELS[exchange];
  const syncedAt = new Date(now).toISOString();
  const warnings: string[] = [];
  const changes: ExchangeSyncChange[] = [];
  const closed: string[] = [];

  // Existing per-exchange figures, keyed by asset so a re-sync can diff them.
  const previous = await db.select().from(exchangeBalances).where(eq(exchangeBalances.exchange, exchange));
  const previousByAsset = new Map(previous.map((row) => [row.assetId, row]));
  const touched = new Set<number>();

  for (const row of reported) {
    let asset = await findCryptoAsset(row.symbol);
    let created = false;
    if (!asset) {
      asset = await createCryptoAsset(exchange, row, warnings);
      created = true;
    }

    const prior = previousByAsset.get(asset.id)?.quantity ?? 0;
    const delta = roundQuantity(row.quantity - prior);
    // Units arriving are valued at today's price (the only figure available for
    // an import); units leaving are valued at cost, so a transfer out does not
    // invent realized P/L the way a sale would.
    const depositPrice = asset.currentPrice > 0 ? asset.currentPrice : asset.avgCost;
    const withdrawPrice = asset.avgCost > 0 ? asset.avgCost : asset.currentPrice;

    let applied = 0;
    if (delta > DUST) {
      applied = await bookChange(asset.id, "deposit", delta, depositPrice, exchange, warnings);
    } else if (delta < -DUST) {
      applied = -await bookChange(asset.id, "withdraw", -delta, withdrawPrice, exchange, warnings);
    }

    await db
      .insert(exchangeBalances)
      .values({ assetId: asset.id, exchange, quantity: row.quantity, symbol: row.symbol, syncedAt: new Date(now) })
      .onConflictDoUpdate({
        target: [exchangeBalances.assetId, exchangeBalances.exchange],
        set: { quantity: row.quantity, symbol: row.symbol, syncedAt: new Date(now) },
      });

    touched.add(asset.id);
    if (applied !== 0 || created) {
      changes.push({ symbol: row.symbol, delta: applied, kind: applied >= 0 ? "deposit" : "withdraw", created });
    }
  }

  // Coins that were on this exchange before and are gone now: book the removal
  // once, then forget the row so a later re-deposit is a clean difference.
  for (const row of previous) {
    if (touched.has(row.assetId)) continue;
    const [asset] = await db.select().from(assets).where(eq(assets.id, row.assetId));
    if (!asset) {
      await db.delete(exchangeBalances).where(eq(exchangeBalances.id, row.id));
      continue;
    }
    if (row.quantity > DUST) {
      const applied = await bookChange(asset.id, "withdraw", row.quantity, asset.avgCost, exchange, warnings);
      if (applied > 0) {
        closed.push(row.symbol || asset.symbol);
        changes.push({ symbol: row.symbol || asset.symbol, delta: -applied, kind: "withdraw", created: false });
      }
    }
    await db.delete(exchangeBalances).where(eq(exchangeBalances.id, row.id));
    touched.add(asset.id);
  }

  for (const assetId of touched) {
    await recomputeAsset(assetId);
  }
  if (touched.size > 0) {
    await recordSnapshot();
  }

  // Nothing held at all is a valid state, but it is nearly always a mistake
  // (sub-accounts, a spot key trying to read a futures wallet) so say so.
  if (reported.length === 0) {
    warnings.push(`${label} returned no balances. If you hold funds there, check the key's account type.`);
  }

  return { exchange, label, syncedAt, reported: reported.length, changes, closed, warnings };
}

/** One sentence for the toast/banner after a sync. */
export function describeSyncResult(result: ExchangeSyncResult, { label = true } = {}): string {
  const prefix = label ? `${result.label}: ` : "";
  const parts: string[] = [];
  const added = result.changes.filter((c) => c.delta > 0 && !c.created);
  const created = result.changes.filter((c) => c.created);
  if (created.length > 0) {
    parts.push(`added ${created.map((c) => c.symbol).join(", ")}`);
  }
  if (added.length > 0) {
    parts.push(`updated ${added.length} ${added.length === 1 ? "holding" : "holdings"}`);
  }
  if (result.closed.length > 0) {
    parts.push(`removed ${result.closed.join(", ")}`);
  }
  if (result.reported === 0) {
    return `${prefix}no balances found.`;
  }
  if (parts.length === 0) {
    return `${prefix}already up to date (${result.reported} ${result.reported === 1 ? "asset" : "assets"}).`;
  }
  return `${prefix}${parts.join(", ")}.`;
}

/** Disconnect: forget the key. Imported holdings stay, marked as manual history. */
export async function disconnectExchange(exchange: ExchangeId): Promise<void> {
  await ensureSchema();
  await clearExchangeCredentials(exchange);
}
