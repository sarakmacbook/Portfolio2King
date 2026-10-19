import { db } from "@/db";
import { assets, snapshots, transactions, type Asset, type AssetType, type Transaction } from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";

let schemaReady: Promise<void> | null = null;
let schemaDatabaseUrl: string | undefined;

/** Safety net so the app works even on a fresh database without drizzle-kit push. */
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
          quantity double precision NOT NULL DEFAULT 0,
          avg_cost double precision NOT NULL DEFAULT 0,
          current_price double precision NOT NULL DEFAULT 0,
          realized_pnl double precision NOT NULL DEFAULT 0,
          notes text NOT NULL DEFAULT '',
          price_updated_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
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

export function today() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export async function recordSnapshot() {
  const list = await db.select().from(assets);
  const t = computeTotals(list);
  const d = today();
  await db
    .insert(snapshots)
    .values({ date: d, totalValue: t.totalValue, costBasis: t.costBasis, cashValue: t.cashValue })
    .onConflictDoUpdate({
      target: snapshots.date,
      set: { totalValue: t.totalValue, costBasis: t.costBasis, cashValue: t.cashValue },
    });
}

export async function getAllAssets() {
  await ensureSchema();
  return db.select().from(assets).orderBy(asc(assets.type), asc(assets.name));
}

export async function getSnapshots() {
  await ensureSchema();
  return db.select().from(snapshots).orderBy(asc(snapshots.date));
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
