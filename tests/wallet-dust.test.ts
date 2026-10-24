import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_DUST_THRESHOLD_USD,
  MAX_DUST_THRESHOLD_USD,
  dustValueOf,
  isDust,
  normaliseDustThreshold,
  splitDust,
} from "../src/lib/wallet-dust";

test("the dust cut-off defaults to one dollar and is clamped to something sane", () => {
  assert.equal(DEFAULT_DUST_THRESHOLD_USD, 1);
  assert.equal(normaliseDustThreshold("1"), 1);
  assert.equal(normaliseDustThreshold("0.5"), 0.5);
  assert.equal(normaliseDustThreshold(5), 5);
  // Blank / junk falls back to the default rather than hiding everything.
  assert.equal(normaliseDustThreshold(""), DEFAULT_DUST_THRESHOLD_USD);
  assert.equal(normaliseDustThreshold("abc"), DEFAULT_DUST_THRESHOLD_USD);
  assert.equal(normaliseDustThreshold(undefined), DEFAULT_DUST_THRESHOLD_USD);
  assert.equal(normaliseDustThreshold(-4), DEFAULT_DUST_THRESHOLD_USD);
  // "Show everything" stays possible, and a typo cannot hide the portfolio.
  assert.equal(normaliseDustThreshold(0), 0);
  assert.equal(normaliseDustThreshold("0"), 0);
  assert.equal(normaliseDustThreshold(1e9), MAX_DUST_THRESHOLD_USD);
  // A currency-formatted value is tolerated.
  assert.equal(normaliseDustThreshold("$2.50"), 2.5);
});

test("dust is measured in dollars, not in quantity", () => {
  assert.equal(isDust({ valueUsd: 0.99 }, 1), true);
  assert.equal(isDust({ valueUsd: 1 }, 1), false, "exactly one dollar is not dust");
  assert.equal(isDust({ valueUsd: 1.01 }, 1), false);
  // A million tokens worth a fraction of a cent are still dust.
  assert.equal(isDust({ valueUsd: 1_000_000 * 0.0000001 }, 1), true);
  // Holdings rows call it `value`.
  assert.equal(isDust({ value: 0.5 }, 1), true);
  assert.equal(isDust({ value: 5 }, 1), false);
  // A cut-off of 0 hides nothing, whatever the value.
  assert.equal(isDust({ valueUsd: 0 }, 0), false);
  assert.equal(dustValueOf({ value: 3 }), 3);
  assert.equal(dustValueOf({ valueUsd: 2 }), 2);
  assert.equal(dustValueOf({}), 0);
});

test("splitDust keeps everything above the cut-off and reports what it hid", () => {
  const balances = [
    { symbol: "ETH", valueUsd: 2650 },
    { symbol: "USDC", valueUsd: 40 },
    { symbol: "ZRO", valueUsd: 2.5 },
    { symbol: "AIRDROP", valueUsd: 0.02 },
    { symbol: "TEST", valueUsd: 0.4 },
  ];

  const split = splitDust(balances, 1);
  assert.deepEqual(split.kept.map((b) => b.symbol), ["ETH", "USDC", "ZRO"]);
  assert.deepEqual(split.dust.map((b) => b.symbol), ["AIRDROP", "TEST"]);
  assert.equal(split.dustCount, 2);
  assert.equal(split.dustValue, 0.42);

  // The list it was given is untouched (safe with React state).
  assert.equal(balances.length, 5);

  // A cut-off of 0 turns the filter off entirely.
  const off = splitDust(balances, 0);
  assert.equal(off.kept.length, 5);
  assert.equal(off.dustCount, 0);
  assert.equal(off.dustValue, 0);

  // An empty wallet is handled without ceremony.
  const empty = splitDust([], 1);
  assert.deepEqual(empty.kept, []);
  assert.equal(empty.dustCount, 0);
});

test("splitDust honours a higher cut-off and the row shape used by holdings", () => {
  const holdings = [
    { id: 1, symbol: "BTC", value: 19000 },
    { id: 2, symbol: "SOL", value: 12 },
    { id: 3, symbol: "DUST", value: 0.2 },
  ];
  const split = splitDust(holdings, 5);
  assert.deepEqual(split.kept.map((row) => row.id), [1, 2]);
  assert.deepEqual(split.dust.map((row) => row.id), [3]);

  // Everything under the cut-off: nothing kept, but the reason is visible.
  const allDust = splitDust(holdings, 1_000_000);
  assert.equal(allDust.kept.length, 0);
  assert.equal(allDust.dustCount, 3);
});

test("the wallet picker and the holdings table both offer the cut-off", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.ok(dialog.includes("Skip tokens under"), "the wallet scan offers it");
  assert.ok(dialog.includes("filterScanBalances("), "the picker uses the shared rules");
  assert.ok(dialog.includes("balances: walletChosen"), "import uses the filtered, ticked list");
  assert.ok(dialog.includes("minValueUsd: walletDustCut"), "the server gets the same cut-off");
  assert.ok(dialog.includes("Show them"), "hidden dust can be revealed");

  const table = readFileSync(resolve(__dirname, "../src/components/HoldingsTable.tsx"), "utf8");
  assert.ok(table.includes("Hide under"), "the holdings table offers it");
  assert.ok(table.includes("dustSplit.kept"), "the table renders the filtered rows");
  assert.ok(table.includes("Show them"), "hidden holdings can be revealed");
  assert.ok(table.includes("dustCut"), "arrange mode has a reason to bypass it");
});

test("the import action applies the cut-off server-side too", () => {
  const actions = readFileSync(resolve(__dirname, "../src/app/actions.ts"), "utf8");
  const body = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(body.includes("minValueUsd"), "the action accepts a cut-off");
  assert.ok(body.includes("isDust("), "dust is skipped while importing");
  assert.ok(body.includes("skippedDust"), "the caller is told how many were skipped");
});
