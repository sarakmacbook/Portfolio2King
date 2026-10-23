import { db } from "@/db";
import {
  assets,
  priceSnapshots,
  snapshots,
  transactions,
  type Asset,
  type AssetType,
  type PriceSnapshot,
  type Transaction,
} from "@/db/schema";
import { fetchPreferredMarketPrice } from "@/lib/market-prices";
import { fetchStockQuote } from "@/lib/stock-prices";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

let schemaReady: Promise<void> | null = null;
let schemaDatabaseUrl: string | undefined;

export function localDateString(d: Date) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function today() {
  return localDateString(new Date());
}

/** Safety net so the app works even on a fresh or existing database without manual drizzle-kit push. */
export function ensureSchema() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url !== schemaDatabaseUrl) {
    schemaReady = null;
    schemaDatabaseUrl = url;
  }
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS assets (
          id serial PRIMARY KEY,
          type text NOT NULL,
          name text NOT NULL,
          symbol text NOT NULL DEFAULT '',
          crypto_category text NOT NULL DEFAULT 'volatile',
          price_source text NOT NULL DEFAULT '',
          quantity double precision NOT NULL DEFAULT 0,
          avg_cost double precision NOT NULL DEFAULT 0,
          current_price double precision NOT NULL DEFAULT 0,
          realized_pnl double precision NOT NULL DEFAULT 0,
          notes text NOT NULL DEFAULT '',
          price_updated_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await db.execute(sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS crypto_category text NOT NULL DEFAULT 'volatile'`);
      // Exchange a crypto asset is pinned to ("" = any provider).
      await db.execute(sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT ''`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS transactions (
          id serial PRIMARY KEY,
          asset_id integer NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          kind text NOT NULL,
          quantity double precision NOT NULL,
          price double precision NOT NULL,
          fee double precision NOT NULL DEFAULT 0,
          date date NOT NULL,
          note text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS snapshots (
          date date PRIMARY KEY,
          total_value double precision NOT NULL,
          cost_basis double precision NOT NULL,
          cash_value double precision NOT NULL
        )`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS price_snapshots (
          asset_id integer NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          date date NOT NULL,
          price double precision NOT NULL,
          PRIMARY KEY (asset_id, date)
        )`);

      // Alerting: Web Push subscriptions, delivered alerts, and app settings.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id serial PRIMARY KEY,
          endpoint text NOT NULL UNIQUE,
          p256dh text NOT NULL,
          auth text NOT NULL,
          user_agent text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now()
        )`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS alert_events (
          id serial PRIMARY KEY,
          dedupe_key text NOT NULL UNIQUE,
          kind text NOT NULL,
          asset_id integer,
          title text NOT NULL,
          body text NOT NULL,
          channels text NOT NULL DEFAULT '',
          push_sent integer NOT NULL DEFAULT 0,
          push_failed integer NOT NULL DEFAULT 0,
          telegram_sent integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      // Per-exchange holdings, so re-syncing one venue never overwrites another.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS exchange_balances (
          id serial PRIMARY KEY,
          asset_id integer NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          exchange text NOT NULL,
          quantity double precision NOT NULL,
          symbol text NOT NULL DEFAULT '',
          synced_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (asset_id, exchange)
        )`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_settings (
          key text PRIMARY KEY,
          value text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);

      // One-time migration: Auto note originally defaulted to off, so any
      // earlier settings save wrote "false" before the default became true.
      const autoNoteMigrated = await db.execute<{ value: string }>(sql`
        SELECT value FROM app_settings WHERE key = 'alerts.portfolio.autoNote.defaultOnMigrated' LIMIT 1
      `);
      if (autoNoteMigrated.rows.length === 0) {
        await db.execute(sql`
          INSERT INTO app_settings (key, value, updated_at)
          VALUES
            ('alerts.portfolio.autoNote', 'true', now()),
            ('alerts.portfolio.autoNote.defaultOnMigrated', '1', now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `);
      }

      // One-time backfill for pre-existing non-cash assets that predate price_snapshots.
      const unseeded = await db.execute<{ id: number }>(sql`
        SELECT a.id
        FROM assets a
        WHERE a.type <> 'cash'
          AND a.current_price > 0
          AND NOT EXISTS (SELECT 1 FROM price_snapshots ps WHERE ps.asset_id = a.id)
      `);
      const unseededIds = unseeded.rows.map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0);
      if (unseededIds.length > 0) {
        const d = today();
        await db.execute(sql`
          INSERT INTO price_snapshots (asset_id, date, price)
          SELECT id, (price_updated_at AT TIME ZONE 'UTC')::date, current_price
          FROM assets
          WHERE ${inArray(assets.id, unseededIds)} AND current_price > 0
          ON CONFLICT (asset_id, date) DO UPDATE SET price = EXCLUDED.price
        `);
        await db.execute(sql`
          INSERT INTO price_snapshots (asset_id, date, price)
          SELECT id, ${d}::date, current_price
          FROM assets
          WHERE ${inArray(assets.id, unseededIds)} AND current_price > 0
          ON CONFLICT (asset_id, date) DO UPDATE SET price = EXCLUDED.price
        `);
        await db.execute(sql`
          INSERT INTO price_snapshots (asset_id, date, price)
          SELECT DISTINCT ON (asset_id, date) asset_id, date, price
          FROM transactions
          WHERE ${inArray(transactions.assetId, unseededIds)}
            AND kind IN ('buy', 'sell')
            AND price > 0
          ORDER BY asset_id, date, id DESC
          ON CONFLICT (asset_id, date) DO NOTHING
        `);
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export type ReplayResult = {
  quantity: number;
  avgCost: number;
  realizedPnl: number;
  error?: string;
};

const EPS = 1e-9;

/** Replays transactions in chronological order to compute holdings. */
export function replay(type: AssetType, txs: Pick<Transaction, "kind" | "quantity" | "price" | "fee">[]): ReplayResult {
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

export async function getAssetTransactions(assetId: number) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.assetId, assetId))
    .orderBy(asc(transactions.date), asc(transactions.id));
}

export async function recomputeAsset(assetId: number) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) return;
  const txs = await getAssetTransactions(assetId);
  const r = replay(asset.type, txs);
  await db
    .update(assets)
    .set({
      quantity: r.quantity,
      avgCost: r.avgCost,
      realizedPnl: r.realizedPnl,
      ...(asset.type === "cash" ? { currentPrice: 1 } : {}),
    })
    .where(eq(assets.id, assetId));
}

export function assetValue(a: Pick<Asset, "quantity" | "currentPrice">) {
  return a.quantity * a.currentPrice;
}

export function assetCost(a: Pick<Asset, "quantity" | "avgCost">) {
  return a.quantity * a.avgCost;
}

export type Totals = {
  totalValue: number;
  costBasis: number;
  unrealized: number;
  realized: number;
  cashValue: number;
  byType: Record<AssetType, number>;
};

export function computeTotals(list: Asset[]): Totals {
  const byType: Record<AssetType, number> = { cash: 0, stock: 0, crypto: 0, other: 0 };
  let totalValue = 0;
  let costBasis = 0;
  let realized = 0;
  for (const a of list) {
    const v = assetValue(a);
    totalValue += v;
    costBasis += assetCost(a);
    realized += a.realizedPnl;
    byType[a.type] = (byType[a.type] ?? 0) + v;
  }
  return {
    totalValue,
    costBasis,
    unrealized: totalValue - costBasis,
    realized,
    cashValue: byType.cash,
    byType,
  };
}

export async function recordAssetPriceSnapshot(assetId: number, snapshotDate: string, price: number, overwrite = true) {
  if (!Number.isFinite(price) || price <= 0) return;
  if (overwrite) {
    await db
      .insert(priceSnapshots)
      .values({ assetId, date: snapshotDate, price })
      .onConflictDoUpdate({
        target: [priceSnapshots.assetId, priceSnapshots.date],
        set: { price },
      });
    return;
  }
  await db
    .insert(priceSnapshots)
    .values({ assetId, date: snapshotDate, price })
    .onConflictDoNothing({ target: [priceSnapshots.assetId, priceSnapshots.date] });
}

export async function recordSnapshot(snapshotDate = today()) {
  await ensureSchema();
  const list = await db.select().from(assets);
  const t = computeTotals(list);
  await db
    .insert(snapshots)
    .values({ date: snapshotDate, totalValue: t.totalValue, costBasis: t.costBasis, cashValue: t.cashValue })
    .onConflictDoUpdate({
      target: snapshots.date,
      set: { totalValue: t.totalValue, costBasis: t.costBasis, cashValue: t.cashValue },
    });

  const priced = list.filter((a) => a.type !== "cash" && a.currentPrice > 0);
  if (priced.length > 0) {
    await db
      .insert(priceSnapshots)
      .values(priced.map((a) => ({ assetId: a.id, date: snapshotDate, price: a.currentPrice })))
      .onConflictDoUpdate({
        target: [priceSnapshots.assetId, priceSnapshots.date],
        set: { price: sql`excluded.price` },
      });
  }
}

/**
 * Ensures today's portfolio snapshot and per-asset price snapshots exist on read
 * without overwriting snapshots already captured today.
 */
export async function ensureDailySnapshot(snapshotDate = today()) {
  await ensureSchema();
  const list = await db.select().from(assets).orderBy(asc(assets.type), asc(assets.name));
  if (list.length > 0) {
    const t = computeTotals(list);
    await db
      .insert(snapshots)
      .values({ date: snapshotDate, totalValue: t.totalValue, costBasis: t.costBasis, cashValue: t.cashValue })
      .onConflictDoNothing({ target: snapshots.date });

    const priced = list.filter((a) => a.type !== "cash" && a.currentPrice > 0);
    if (priced.length > 0) {
      await db
        .insert(priceSnapshots)
        .values(priced.map((a) => ({ assetId: a.id, date: snapshotDate, price: a.currentPrice })))
        .onConflictDoNothing({ target: [priceSnapshots.assetId, priceSnapshots.date] });
    }
  }
  return list;
}

export type DailySnapshotRunResult = {
  date: string;
  totalAssets: number;
  totalCrypto: number;
  attemptedCrypto: number;
  refreshedCrypto: number;
  /** Stock holdings with a symbol (priced through Yahoo Finance). */
  totalStocks: number;
  attemptedStocks: number;
  refreshedStocks: number;
  snapshottedAssets: number;
};

/**
 * Fetches fresh live prices for crypto (exchange APIs) and stocks (Yahoo
 * Finance) and records daily price & portfolio snapshots.
 * Shared by manual one-click refresh, background daily check, and the scheduled
 * daily cron job.
 *
 * `onlyStale` limits the run to holdings not yet priced today (crypto and
 * stocks alike); `staleAfterMs` uses a rolling age instead.
 */
export async function runDailyPriceSnapshot(
  options: { onlyStale?: boolean; staleAfterMs?: number } = {},
): Promise<DailySnapshotRunResult> {
  await ensureSchema();
  const list = await db.select().from(assets);
  const d = today();
  const allCrypto = list.filter((asset) => asset.type === "crypto" && asset.symbol.trim() !== "");
  const allStocks = list.filter((asset) => asset.type === "stock" && asset.symbol.trim() !== "");
  const staleBefore = options.staleAfterMs ? Date.now() - options.staleAfterMs : null;

  const pickTargets = <T extends { priceUpdatedAt: Date }>(candidates: T[]): T[] =>
    staleBefore !== null
      ? candidates.filter((asset) => asset.priceUpdatedAt.getTime() <= staleBefore)
      : options.onlyStale
        ? candidates.filter((asset) => localDateString(asset.priceUpdatedAt) < d)
        : candidates;

  const targets = pickTargets(allCrypto);
  const stockTargets = pickTargets(allStocks);

  let refreshedCrypto = 0;
  let refreshedStocks = 0;

  // Stocks and crypto share the same write-back step, so a symbol that fails on
  // one side never blocks the other.
  const found: Array<{ id: number; price: number }> = [];

  await Promise.all([
    (async () => {
      if (targets.length === 0) return;
      const results = await Promise.all(
        targets.map(async (asset) => {
          try {
            // The exchange picked when the asset was added goes first.
            const { price } = await fetchPreferredMarketPrice(asset.priceSource, asset.symbol, "USDT");
            return { id: asset.id, price };
          } catch {
            return { id: asset.id, price: null };
          }
        }),
      );
      for (const result of results) {
        if (result.price !== null) {
          refreshedCrypto += 1;
          found.push({ id: result.id, price: result.price });
        }
      }
    })(),
    (async () => {
      if (stockTargets.length === 0) return;
      const results = await Promise.all(
        stockTargets.map(async (asset) => {
          try {
            const quote = await fetchStockQuote(asset.symbol);
            return { id: asset.id, price: quote.price };
          } catch {
            return { id: asset.id, price: null };
          }
        }),
      );
      for (const result of results) {
        if (result.price !== null) {
          refreshedStocks += 1;
          found.push({ id: result.id, price: result.price });
        }
      }
    })(),
  ]);

  if (found.length > 0) {
    const updatedAt = new Date();
    for (const { id, price } of found) {
      await db.update(assets).set({ currentPrice: price, priceUpdatedAt: updatedAt }).where(eq(assets.id, id));
    }
  }

  if (list.length > 0) {
    await recordSnapshot(d);
  }

  const latestList = await db.select().from(assets);
  const snapshottedAssets = latestList.filter((a) => a.type !== "cash" && a.currentPrice > 0).length;

  return {
    date: d,
    totalAssets: latestList.length,
    totalCrypto: allCrypto.length,
    attemptedCrypto: targets.length,
    refreshedCrypto,
    totalStocks: allStocks.length,
    attemptedStocks: stockTargets.length,
    refreshedStocks,
    snapshottedAssets,
  };
}

export async function getAllAssets() {
  return ensureDailySnapshot();
}

export async function getSnapshots() {
  await ensureSchema();
  return db.select().from(snapshots).orderBy(asc(snapshots.date));
}

export async function getAssetPriceSnapshots(assetId: number): Promise<PriceSnapshot[]> {
  await ensureSchema();
  return db
    .select()
    .from(priceSnapshots)
    .where(eq(priceSnapshots.assetId, assetId))
    .orderBy(asc(priceSnapshots.date));
}

export async function getAllPriceSnapshots(): Promise<PriceSnapshot[]> {
  await ensureSchema();
  return db
    .select()
    .from(priceSnapshots)
    .orderBy(asc(priceSnapshots.assetId), asc(priceSnapshots.date));
}

export async function getRecentActivity(limit = 100) {
  await ensureSchema();
  return db
    .select({
      tx: transactions,
      asset: { id: assets.id, name: assets.name, symbol: assets.symbol, type: assets.type },
    })
    .from(transactions)
    .innerJoin(assets, eq(assets.id, transactions.assetId))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit);
}
