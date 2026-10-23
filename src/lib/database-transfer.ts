import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { assets, exchangeBalances, priceSnapshots, snapshots, transactions } from "@/db/schema";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { createBackup, type PortfolioBackup } from "@/lib/database-backup";
import { ensureSchema } from "@/lib/portfolio";

export type ImportMode = "replace" | "merge";

export type ImportSummary = {
  mode: ImportMode;
  assets: number;
  transactions: number;
  snapshots: number;
  priceSnapshots: number;
  exchangeBalances: number;
};

/** Read every portfolio table and build a portable backup document. */
export async function exportBackup(): Promise<PortfolioBackup> {
  await ensureSchema();
  const [assetRows, transactionRows, snapshotRows, priceSnapshotRows, exchangeBalanceRows] = await Promise.all([
    db.select().from(assets).orderBy(asc(assets.id)),
    db.select().from(transactions).orderBy(asc(transactions.id)),
    db.select().from(snapshots).orderBy(asc(snapshots.date)),
    db.select().from(priceSnapshots).orderBy(asc(priceSnapshots.assetId), asc(priceSnapshots.date)),
    db.select().from(exchangeBalances).orderBy(asc(exchangeBalances.assetId), asc(exchangeBalances.exchange)),
  ]);
  return createBackup(
    assetRows,
    transactionRows,
    snapshotRows,
    new Date(),
    priceSnapshotRows,
    exchangeBalanceRows,
  );
}

async function insertAsset(client: PoolClient, asset: PortfolioBackup["tables"]["assets"][number], id?: number) {
  const values = [
    asset.type,
    asset.name,
    asset.symbol,
    asset.cryptoCategory,
    asset.priceSource ?? "",
    asset.quantity,
    asset.avgCost,
    asset.currentPrice,
    asset.realizedPnl,
    asset.notes,
    asset.priceUpdatedAt,
    asset.createdAt,
  ];
  if (id === undefined) {
    const result = await client.query<{ id: number }>(
      `INSERT INTO assets (type, name, symbol, crypto_category, price_source, quantity, avg_cost, current_price, realized_pnl, notes, price_updated_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      values,
    );
    return result.rows[0].id;
  }
  await client.query(
    `INSERT INTO assets (id, type, name, symbol, crypto_category, price_source, quantity, avg_cost, current_price, realized_pnl, notes, price_updated_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, ...values],
  );
  return id;
}

async function insertTransaction(client: PoolClient, tx: PortfolioBackup["tables"]["transactions"][number], assetId: number, id?: number) {
  const values = [assetId, tx.kind, tx.quantity, tx.price, tx.fee, tx.date, tx.note, tx.createdAt];
  if (id === undefined) {
    await client.query(
      `INSERT INTO transactions (asset_id, kind, quantity, price, fee, date, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      values,
    );
  } else {
    await client.query(
      `INSERT INTO transactions (id, asset_id, kind, quantity, price, fee, date, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ...values],
    );
  }
}

async function insertSnapshot(client: PoolClient, snapshot: PortfolioBackup["tables"]["snapshots"][number], upsert: boolean) {
  await client.query(
    `INSERT INTO snapshots (date, total_value, cost_basis, cash_value) VALUES ($1,$2,$3,$4)
     ${upsert ? "ON CONFLICT (date) DO UPDATE SET total_value = EXCLUDED.total_value, cost_basis = EXCLUDED.cost_basis, cash_value = EXCLUDED.cash_value" : ""}`,
    [snapshot.date, snapshot.totalValue, snapshot.costBasis, snapshot.cashValue],
  );
}

async function insertPriceSnapshot(
  client: PoolClient,
  priceSnapshot: PortfolioBackup["tables"]["priceSnapshots"][number],
  assetId: number,
  upsert: boolean,
) {
  await client.query(
    `INSERT INTO price_snapshots (asset_id, date, price) VALUES ($1,$2,$3)
     ${upsert ? "ON CONFLICT (asset_id, date) DO UPDATE SET price = EXCLUDED.price" : ""}`,
    [assetId, priceSnapshot.date, priceSnapshot.price],
  );
}

/**
 * Restores the sync baseline. Without it the next sync would compare against
 * zero and import every balance again, doubling the portfolio.
 */
async function insertExchangeBalance(
  client: PoolClient,
  balance: NonNullable<PortfolioBackup["tables"]["exchangeBalances"]>[number],
  assetId: number,
  upsert: boolean,
) {
  await client.query(
    `INSERT INTO exchange_balances (asset_id, exchange, quantity, symbol, synced_at) VALUES ($1,$2,$3,$4,$5)
     ${upsert ? "ON CONFLICT (asset_id, exchange) DO UPDATE SET quantity = EXCLUDED.quantity, symbol = EXCLUDED.symbol, synced_at = EXCLUDED.synced_at" : ""}`,
    [assetId, balance.exchange, balance.quantity, balance.symbol, balance.syncedAt],
  );
}

/** Keep serial sequences ahead of any explicitly restored ids. */
async function resetSequences(client: PoolClient) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('assets', 'id'), COALESCE((SELECT MAX(id) FROM assets), 1), EXISTS (SELECT 1 FROM assets))`,
  );
  await client.query(
    `SELECT setval(pg_get_serial_sequence('transactions', 'id'), COALESCE((SELECT MAX(id) FROM transactions), 1), EXISTS (SELECT 1 FROM transactions))`,
  );
  await client.query(
    `SELECT setval(pg_get_serial_sequence('exchange_balances', 'id'), COALESCE((SELECT MAX(id) FROM exchange_balances), 1), EXISTS (SELECT 1 FROM exchange_balances))`,
  );
}

/**
 * Import a validated backup in a single transaction: either it applies
 * completely or the database is left untouched.
 *
 * - `replace`: wipe the current portfolio, then restore the backup with
 *   its original ids (a true restore — export first if unsure).
 * - `merge`: keep current data; backup assets/transactions are inserted
 *   with fresh ids (transactions and price snapshots are remapped to the
 *   new asset ids) and snapshots for a date already present are overwritten
 *   by the backup.
 */
export async function importBackup(backup: PortfolioBackup, mode: ImportMode): Promise<ImportSummary> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const exchangeBalanceRows = backup.tables.exchangeBalances ?? [];
    if (mode === "replace") {
      await client.query("DELETE FROM exchange_balances");
      await client.query("DELETE FROM price_snapshots");
      await client.query("DELETE FROM snapshots");
      await client.query("DELETE FROM transactions");
      await client.query("DELETE FROM assets");
      for (const asset of backup.tables.assets) await insertAsset(client, asset, asset.id);
      for (const tx of backup.tables.transactions) await insertTransaction(client, tx, tx.assetId, tx.id);
      for (const snapshot of backup.tables.snapshots) await insertSnapshot(client, snapshot, false);
      for (const ps of backup.tables.priceSnapshots) await insertPriceSnapshot(client, ps, ps.assetId, false);
      for (const balance of exchangeBalanceRows) {
        await insertExchangeBalance(client, balance, balance.assetId, false);
      }
    } else {
      const idMap = new Map<number, number>();
      for (const asset of backup.tables.assets) idMap.set(asset.id, await insertAsset(client, asset));
      for (const tx of backup.tables.transactions) await insertTransaction(client, tx, idMap.get(tx.assetId)!);
      for (const snapshot of backup.tables.snapshots) await insertSnapshot(client, snapshot, true);
      for (const ps of backup.tables.priceSnapshots) {
        await insertPriceSnapshot(client, ps, idMap.get(ps.assetId)!, true);
      }
      for (const balance of exchangeBalanceRows) {
        await insertExchangeBalance(client, balance, idMap.get(balance.assetId)!, true);
      }
    }
    await resetSequences(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return {
    mode,
    assets: backup.tables.assets.length,
    transactions: backup.tables.transactions.length,
    snapshots: backup.tables.snapshots.length,
    priceSnapshots: backup.tables.priceSnapshots.length,
    exchangeBalances: backup.tables.exchangeBalances?.length ?? 0,
  };
}
