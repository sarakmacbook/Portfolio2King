import {
  ASSET_TYPES,
  CRYPTO_CATEGORIES,
  TX_KINDS,
  type Asset,
  type AssetType,
  type CryptoCategory,
  type ExchangeBalance,
  type PriceSnapshot,
  type Snapshot,
  type Transaction,
  type TxKind,
} from "@/db/schema";
import { EXCHANGE_IDS } from "@/lib/exchanges";
import { parsePriceSource, type PriceProvider } from "@/lib/market-prices";
import { replay } from "@/lib/portfolio";

/**
 * Versioned, portable backup of the whole (custom) Ledgerly database.
 *
 * The format is plain JSON so it can be stored, diffed, inspected, and
 * re-imported on any Ledgerly deployment — it does not depend on the
 * PostgreSQL server version, unlike a raw `pg_dump`.
 *
 *   { app: "ledgerly", kind: "portfolio-database-backup", version: 1,
 *     exportedAt: "<ISO timestamp>",
 *     tables: { assets: [...], transactions: [...], snapshots: [...], priceSnapshots: [...],
 *               exchangeBalances: [...] } }
 *
 * `exchangeBalances` is optional: files written before exchange imports existed
 * simply do not have it. It must travel with a backup, because it is the
 * baseline a re-sync diffs against — restoring without it would make the next
 * sync import every balance a second time. API keys are never exported.
 */

export const BACKUP_APP = "ledgerly";
export const BACKUP_KIND = "portfolio-database-backup";
export const BACKUP_VERSION = 1;

/** Hard limits so a hostile / corrupt file cannot exhaust memory or the DB. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_BACKUP_ROWS = {
  assets: 10_000,
  transactions: 100_000,
  snapshots: 20_000,
  priceSnapshots: 500_000,
  exchangeBalances: 100_000,
} as const;

export type BackupAsset = Omit<Asset, "priceUpdatedAt" | "createdAt" | "priceSource"> & {
  priceUpdatedAt: string;
  createdAt: string;
  /** Absent in backups written before an asset could be pinned to an exchange. */
  priceSource?: PriceProvider | "";
};
export type BackupTransaction = Omit<Transaction, "createdAt"> & { createdAt: string };
export type BackupSnapshot = Snapshot;
export type BackupPriceSnapshot = PriceSnapshot;
/** Last figure each exchange reported for an asset — the sync baseline. */
export type BackupExchangeBalance = Omit<ExchangeBalance, "id" | "syncedAt"> & { syncedAt: string };

export type PortfolioBackup = {
  app: typeof BACKUP_APP;
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  tables: {
    assets: BackupAsset[];
    transactions: BackupTransaction[];
    snapshots: BackupSnapshot[];
    priceSnapshots: BackupPriceSnapshot[];
    exchangeBalances?: BackupExchangeBalance[];
  };
};

export class BackupValidationError extends Error {}

function fail(message: string): never {
  throw new BackupValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

/** Build a backup document from rows as returned by Drizzle / pg. */
export function createBackup(
  assets: Asset[],
  transactions: Transaction[],
  snapshots: Snapshot[],
  exportedAt = new Date(),
  priceSnapshots: PriceSnapshot[] = [],
  exchangeBalances: ExchangeBalance[] = [],
): PortfolioBackup {
  const tables: PortfolioBackup["tables"] = {
    assets: assets.map((a) => ({
      ...a,
      priceUpdatedAt: toIsoTimestamp(a.priceUpdatedAt),
      createdAt: toIsoTimestamp(a.createdAt),
    })),
    transactions: transactions.map((t) => ({
      ...t,
      date: toIsoDate(t.date),
      createdAt: toIsoTimestamp(t.createdAt),
    })),
    snapshots: snapshots.map((s) => ({ ...s, date: toIsoDate(s.date) })),
    priceSnapshots: priceSnapshots.map((p) => ({
      assetId: p.assetId,
      date: toIsoDate(p.date),
      price: p.price,
    })),
  };
  // Only written when there is something to write, so a portfolio without
  // exchange imports keeps producing byte-identical backups.
  if (exchangeBalances.length > 0) {
    tables.exchangeBalances = exchangeBalances.map((row) => ({
      assetId: row.assetId,
      exchange: row.exchange,
      quantity: row.quantity,
      symbol: row.symbol,
      syncedAt: toIsoTimestamp(row.syncedAt),
    }));
  }
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    tables,
  };
}

function stringField(row: Record<string, unknown>, field: string, max: number, { allowEmpty = true } = {}): string {
  const value = row[field];
  if (typeof value !== "string") fail(`Backup row has a missing or non-text "${field}".`);
  if (value.length > max) fail(`Backup "${field}" is longer than ${max} characters.`);
  if (!allowEmpty && !value.trim()) fail(`Backup "${field}" must not be empty.`);
  return value;
}

function numberField(row: Record<string, unknown>, field: string, { min = 0, exclusiveMin = false } = {}): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`Backup row has a missing or non-numeric "${field}".`);
  if (exclusiveMin ? value <= min : value < min) {
    fail(`Backup "${field}" must be ${exclusiveMin ? "greater than" : "at least"} ${min}.`);
  }
  return value;
}

function idField(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`Backup row has an invalid "${field}" (expected a positive integer id).`);
  }
  return value;
}

function dateField(row: Record<string, unknown>, field: string): string {
  const value = stringField(row, field, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) fail(`Backup "${field}" must be a YYYY-MM-DD date, got "${value}".`);
  const [, y, m, d] = match.map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    fail(`Backup "${field}" is not a real calendar date: "${value}".`);
  }
  return value;
}

function timestampField(row: Record<string, unknown>, field: string): string {
  const value = stringField(row, field, 64, { allowEmpty: false });
  if (Number.isNaN(Date.parse(value))) fail(`Backup "${field}" is not a valid timestamp: "${value}".`);
  return new Date(value).toISOString();
}

function rows(value: unknown, table: keyof typeof MAX_BACKUP_ROWS): Record<string, unknown>[] {
  if (!Array.isArray(value)) fail(`Backup is missing the "${table}" table (expected an array).`);
  if (value.length > MAX_BACKUP_ROWS[table]) fail(`Backup has too many ${table} rows (limit ${MAX_BACKUP_ROWS[table]}).`);
  for (const row of value) if (!isRecord(row)) fail(`Backup "${table}" contains a row that is not an object.`);
  return value as Record<string, unknown>[];
}

/**
 * Parse and strictly validate an untrusted backup document.
 *
 * Rejects unknown formats/versions, duplicate or dangling ids, invalid
 * asset/transaction kinds, bad dates/numbers, and transaction histories
 * that could never have been produced by the app (e.g. selling more than
 * was held at that point). Returns rows whose derived asset balances
 * (quantity / avgCost / realizedPnl) are recomputed from their
 * transactions, so hand-edited derived fields cannot corrupt the import.
 */
export function parseBackup(input: unknown): PortfolioBackup {
  if (!isRecord(input)) fail("Backup file must contain a JSON object.");
  if (input.app !== BACKUP_APP || input.kind !== BACKUP_KIND) {
    fail("This file is not a Ledgerly portfolio backup. Choose a file created by Export database.");
  }
  if (input.version !== BACKUP_VERSION) {
    fail(`Unsupported backup version ${JSON.stringify(input.version)}. This app supports version ${BACKUP_VERSION}.`);
  }
  if (!isRecord(input.tables)) fail("Backup is missing its \"tables\" section.");

  const assets: BackupAsset[] = rows(input.tables.assets, "assets").map((row) => {
    const type = stringField(row, "type", 32);
    if (!(ASSET_TYPES as readonly string[]).includes(type)) fail(`Unknown asset type "${type}".`);
    const rawCategory = row.cryptoCategory;
    const cryptoCategory: CryptoCategory = typeof rawCategory === "string" && (CRYPTO_CATEGORIES as readonly string[]).includes(rawCategory)
      ? rawCategory as CryptoCategory
      : "volatile"; // Backward compatibility with version 1 backups created before subcategories.
    // Unknown or missing sources mean "any exchange", never an import failure:
    // older backups predate the picker and a typo must not block a restore.
    const priceSource = parsePriceSource(row.priceSource);
    return {
      id: idField(row, "id"),
      type: type as AssetType,
      name: stringField(row, "name", 200, { allowEmpty: false }),
      symbol: stringField(row, "symbol", 64),
      cryptoCategory,
      priceSource: type === "crypto" ? priceSource : "",
      quantity: numberField(row, "quantity"),
      avgCost: numberField(row, "avgCost"),
      currentPrice: numberField(row, "currentPrice"),
      realizedPnl: numberField(row, "realizedPnl", { min: Number.NEGATIVE_INFINITY }),
      notes: stringField(row, "notes", 5_000),
      priceUpdatedAt: timestampField(row, "priceUpdatedAt"),
      createdAt: timestampField(row, "createdAt"),
    };
  });
  const assetIds = new Set<number>();
  for (const asset of assets) {
    if (assetIds.has(asset.id)) fail(`Backup contains asset id ${asset.id} more than once.`);
    assetIds.add(asset.id);
    if (asset.type === "cash" && asset.currentPrice !== 1) {
      // Cash is always priced 1:1 in Ledgerly; normalise instead of trusting the file.
      asset.currentPrice = 1;
    }
  }

  const transactions: BackupTransaction[] = rows(input.tables.transactions, "transactions").map((row) => {
    const kind = stringField(row, "kind", 32);
    if (!(TX_KINDS as readonly string[]).includes(kind)) fail(`Unknown transaction kind "${kind}".`);
    const assetId = idField(row, "assetId");
    if (!assetIds.has(assetId)) fail(`Transaction references asset id ${assetId}, which is not in the backup.`);
    return {
      id: idField(row, "id"),
      assetId,
      kind: kind as TxKind,
      quantity: numberField(row, "quantity", { min: 0, exclusiveMin: true }),
      price: numberField(row, "price"),
      fee: numberField(row, "fee"),
      date: dateField(row, "date"),
      note: stringField(row, "note", 1_000),
      createdAt: timestampField(row, "createdAt"),
    };
  });
  const transactionIds = new Set<number>();
  for (const tx of transactions) {
    if (transactionIds.has(tx.id)) fail(`Backup contains transaction id ${tx.id} more than once.`);
    transactionIds.add(tx.id);
  }

  const snapshots: BackupSnapshot[] = rows(input.tables.snapshots, "snapshots").map((row) => ({
    date: dateField(row, "date"),
    totalValue: numberField(row, "totalValue"),
    costBasis: numberField(row, "costBasis"),
    cashValue: numberField(row, "cashValue"),
  }));
  const snapshotDates = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshotDates.has(snapshot.date)) fail(`Backup contains snapshot date ${snapshot.date} more than once.`);
    snapshotDates.add(snapshot.date);
  }

  // Backward compatibility: older v1 backups may omit `priceSnapshots`.
  const rawPriceSnapshots = input.tables.priceSnapshots === undefined ? [] : rows(input.tables.priceSnapshots, "priceSnapshots");
  const priceSnapshots: BackupPriceSnapshot[] = rawPriceSnapshots.map((row) => {
    const assetId = idField(row, "assetId");
    if (!assetIds.has(assetId)) fail(`Price snapshot references asset id ${assetId}, which is not in the backup.`);
    return {
      assetId,
      date: dateField(row, "date"),
      price: numberField(row, "price", { min: 0, exclusiveMin: true }),
    };
  });
  const priceSnapshotKeys = new Set<string>();
  for (const ps of priceSnapshots) {
    const key = `${ps.assetId}:${ps.date}`;
    if (priceSnapshotKeys.has(key)) {
      fail(`Backup contains price snapshot (${ps.assetId}, ${ps.date}) more than once.`);
    }
    priceSnapshotKeys.add(key);
  }

  // Backward compatibility: backups written before exchange imports omit this.
  const rawExchangeBalances =
    input.tables.exchangeBalances === undefined ? [] : rows(input.tables.exchangeBalances, "exchangeBalances");
  const exchangeBalances: BackupExchangeBalance[] = rawExchangeBalances.map((row) => {
    const assetId = idField(row, "assetId");
    if (!assetIds.has(assetId)) fail(`Exchange balance references asset id ${assetId}, which is not in the backup.`);
    const exchange = stringField(row, "exchange", 32);
    if (!(EXCHANGE_IDS as readonly string[]).includes(exchange)) fail(`Unknown exchange "${exchange}".`);
    return {
      assetId,
      exchange,
      quantity: numberField(row, "quantity", { min: 0 }),
      symbol: stringField(row, "symbol", 32),
      syncedAt: timestampField(row, "syncedAt"),
    };
  });
  const exchangeBalanceKeys = new Set<string>();
  for (const balance of exchangeBalances) {
    const key = `${balance.assetId}:${balance.exchange}`;
    if (exchangeBalanceKeys.has(key)) {
      fail(`Backup contains the ${balance.exchange} balance for asset ${balance.assetId} more than once.`);
    }
    exchangeBalanceKeys.add(key);
  }

  // Recompute derived balances per asset and reject impossible histories.
  for (const asset of assets) {
    const own = transactions
      .filter((t) => t.assetId === asset.id)
      .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    if (!own.length) continue;
    const result = replay(asset.type, own);
    if (result.error) fail(`Transactions for asset "${asset.name}" (id ${asset.id}) are inconsistent: ${result.error}`);
    asset.quantity = result.quantity;
    asset.avgCost = result.avgCost;
    asset.realizedPnl = result.realizedPnl;
    if (asset.type === "cash") asset.currentPrice = 1;
  }

  const exportedAt =
    typeof input.exportedAt === "string" && !Number.isNaN(Date.parse(input.exportedAt))
      ? new Date(input.exportedAt).toISOString()
      : new Date(0).toISOString();

  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt,
    tables: {
      assets,
      transactions,
      snapshots,
      priceSnapshots,
      ...(exchangeBalances.length > 0 ? { exchangeBalances } : {}),
    },
  };
}

export function backupFileName(date = new Date()): string {
  return `ledgerly-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function backupCounts(backup: PortfolioBackup) {
  return {
    assets: backup.tables.assets.length,
    transactions: backup.tables.transactions.length,
    snapshots: backup.tables.snapshots.length,
    priceSnapshots: backup.tables.priceSnapshots.length,
    exchangeBalances: backup.tables.exchangeBalances?.length ?? 0,
  };
}
