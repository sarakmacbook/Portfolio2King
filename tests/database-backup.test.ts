import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BackupValidationError,
  backupCounts,
  backupFileName,
  createBackup,
  parseBackup,
} from "../src/lib/database-backup";
import type { Asset, PriceSnapshot, Snapshot, Transaction } from "../src/db/schema";

const now = new Date("2026-01-02T03:04:05.000Z");

const assets: Asset[] = [
  { id: 1, type: "cash", name: "Main cash", symbol: "", cryptoCategory: "volatile", priceSource: "", quantity: 900, avgCost: 1, currentPrice: 1, realizedPnl: 0, notes: "", priceUpdatedAt: now, createdAt: now },
  { id: 2, type: "stock", name: "Apple", symbol: "AAPL", cryptoCategory: "volatile", priceSource: "", quantity: 10, avgCost: 100, currentPrice: 150, realizedPnl: 0, notes: "core", priceUpdatedAt: now, createdAt: now },
];
const transactions: Transaction[] = [
  { id: 1, assetId: 1, kind: "deposit", quantity: 900, price: 1, fee: 0, date: "2026-01-01", note: "", createdAt: now },
  { id: 2, assetId: 2, kind: "buy", quantity: 10, price: 100, fee: 0, date: "2026-01-01", note: "Opening balance", createdAt: now },
];
const snapshots: Snapshot[] = [{ date: "2026-01-01", totalValue: 2400, costBasis: 1900, cashValue: 900 }];
const priceSnapshots: PriceSnapshot[] = [
  { assetId: 2, date: "2026-01-01", price: 100 },
  { assetId: 2, date: "2026-01-02", price: 150 },
];

function validBackup() {
  return createBackup(assets, transactions, snapshots, now, priceSnapshots);
}

test("createBackup emits a versioned document with daily price snapshots that parseBackup accepts", () => {
  const backup = validBackup();
  assert.equal(backup.app, "ledgerly");
  assert.equal(backup.kind, "portfolio-database-backup");
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, now.toISOString());
  assert.deepEqual(backupCounts(backup), { assets: 2, transactions: 2, snapshots: 1, priceSnapshots: 2 });
  assert.match(backupFileName(now), /^ledgerly-backup-2026-01-02\.json$/);

  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(parsed.tables.assets[1].quantity, 10);
  assert.equal(parsed.tables.assets[1].avgCost, 100);
  assert.equal(parsed.tables.transactions[0].date, "2026-01-01");
  assert.deepEqual(parsed.tables.priceSnapshots, priceSnapshots);
});

test("parseBackup accepts legacy v1 backups without a priceSnapshots table", () => {
  const legacy = JSON.parse(JSON.stringify(validBackup()));
  delete legacy.tables.priceSnapshots;
  const parsed = parseBackup(legacy);
  assert.deepEqual(parsed.tables.priceSnapshots, []);
});

test("parseBackup recomputes derived balances and normalises cash price", () => {
  const backup = validBackup();
  // Tampered derived fields must not survive an import.
  backup.tables.assets[1].quantity = 999;
  backup.tables.assets[1].avgCost = 1;
  backup.tables.assets[0].currentPrice = 42;
  const parsed = parseBackup(backup);
  assert.equal(parsed.tables.assets[1].quantity, 10);
  assert.equal(parsed.tables.assets[1].avgCost, 100);
  assert.equal(parsed.tables.assets[0].currentPrice, 1);
});

test("parseBackup rejects foreign, future, corrupt, and inconsistent files", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["not an object", "nope", /JSON object/],
    ["foreign file", { ...validBackup(), app: "other" }, /not a Ledgerly/],
    ["future version", { ...validBackup(), version: 99 }, /version 99/],
    ["missing tables", { ...validBackup(), tables: undefined }, /tables/],
  ];
  for (const [name, input, pattern] of cases) {
    assert.throws(() => parseBackup(input), (e: Error) => e instanceof BackupValidationError && pattern.test(e.message), name);
  }

  const duplicate = validBackup();
  duplicate.tables.assets.push({ ...duplicate.tables.assets[0] });
  assert.throws(() => parseBackup(duplicate), /more than once/);

  const dangling = validBackup();
  dangling.tables.transactions[0].assetId = 777;
  assert.throws(() => parseBackup(dangling), /not in the backup/);

  const danglingPrice = validBackup();
  danglingPrice.tables.priceSnapshots.push({ assetId: 999, date: "2026-01-02", price: 150 });
  assert.throws(() => parseBackup(danglingPrice), /not in the backup/);

  const duplicatePrice = validBackup();
  duplicatePrice.tables.priceSnapshots.push({ assetId: 2, date: "2026-01-02", price: 155 });
  assert.throws(() => parseBackup(duplicatePrice), /more than once/);

  const badKind = validBackup();
  (badKind.tables.transactions[0] as { kind: string }).kind = "short";
  assert.throws(() => parseBackup(badKind), /Unknown transaction kind/);

  const badDate = validBackup();
  badDate.tables.snapshots[0].date = "2026-02-30";
  assert.throws(() => parseBackup(badDate), /not a real calendar date/);

  const negative = validBackup();
  negative.tables.assets[0].quantity = -5;
  assert.throws(() => parseBackup(negative), /at least 0/);

  const oversell = validBackup();
  oversell.tables.transactions.push({
    id: 3, assetId: 2, kind: "sell", quantity: 11, price: 150, fee: 0,
    date: "2026-01-02", note: "", createdAt: now.toISOString(),
  });
  assert.throws(() => parseBackup(oversell), /inconsistent/);
});

test("the exchange an asset was added from survives export and import", () => {
  const withCrypto: Asset[] = [
    ...assets,
    {
      id: 3, type: "crypto", name: "Bitcoin", symbol: "BTC", cryptoCategory: "volatile", priceSource: "binance",
      quantity: 1, avgCost: 40_000, currentPrice: 60_000, realizedPnl: 0, notes: "", priceUpdatedAt: now, createdAt: now,
    },
    {
      id: 4, type: "crypto", name: "Ether", symbol: "ETH", cryptoCategory: "volatile", priceSource: "",
      quantity: 2, avgCost: 1_500, currentPrice: 2_000, realizedPnl: 0, notes: "", priceUpdatedAt: now, createdAt: now,
    },
  ];
  const backup = createBackup(withCrypto, [], snapshots, now, []);
  assert.equal(backup.tables.assets[2].priceSource, "binance");

  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(parsed.tables.assets[2].priceSource, "binance");
  assert.equal(parsed.tables.assets[3].priceSource, "");

  // Older backups have no priceSource at all: they must still import, as "auto".
  const legacy = JSON.parse(JSON.stringify(backup));
  for (const row of legacy.tables.assets) delete row.priceSource;
  const legacyParsed = parseBackup(legacy);
  assert.equal(legacyParsed.tables.assets[2].priceSource, "");

  // An unknown exchange in a hand-edited file falls back to "auto" instead of
  // failing the whole restore.
  const typo = JSON.parse(JSON.stringify(backup));
  typo.tables.assets[2].priceSource = "binanse";
  assert.equal(parseBackup(typo).tables.assets[2].priceSource, "");

  // Only crypto keeps a source; a stock row claiming one is normalised away.
  const stockWithSource = JSON.parse(JSON.stringify(backup));
  stockWithSource.tables.assets[1].priceSource = "kraken";
  assert.equal(parseBackup(stockWithSource).tables.assets[1].priceSource, "");
});
