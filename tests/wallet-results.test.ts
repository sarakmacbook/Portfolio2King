import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  groupWalletBalancesByChain,
  searchWalletBalances,
  walletValueUsd,
} from "../src/lib/wallet-results";

type Row = {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  chainLabel: string;
  valueUsd: number;
  cmcName?: string;
};

const rows: Row[] = [
  { id: "usdc-base", symbol: "USDC", name: "USD Coin", chain: "base", chainLabel: "Base", valueUsd: 120 },
  { id: "eth-base", symbol: "ETH", name: "Ethereum", chain: "base", chainLabel: "Base", valueUsd: 3_000 },
  { id: "usdt-eth", symbol: "USDT", name: "Tether USD", chain: "ethereum", chainLabel: "Ethereum", valueUsd: 500 },
  { id: "renamed", symbol: "RNDR", name: "Render", chain: "ethereum", chainLabel: "Ethereum", valueUsd: 40, cmcName: "Render" },
  { id: "unpriced", symbol: "NEW", name: "New Token", chain: "polygon", chainLabel: "Polygon", valueUsd: 0 },
];

test("the search matches ticker, name, chain and CoinMarketCap's name", () => {
  // An empty (or blank) box shows everything, so the caller needs no branch.
  assert.equal(searchWalletBalances(rows, "").length, rows.length);
  assert.equal(searchWalletBalances(rows, "   ").length, rows.length);

  assert.deepEqual(searchWalletBalances(rows, "usd").map((row) => row.id), ["usdc-base", "usdt-eth"]);
  assert.deepEqual(searchWalletBalances(rows, "USD COIN").map((row) => row.id), ["usdc-base"]);
  assert.deepEqual(searchWalletBalances(rows, "eth").map((row) => row.id), [
    "eth-base",
    "usdt-eth",
    "renamed",
  ]);
  // The chain is searchable both ways: the id and the label the scan sent.
  assert.deepEqual(searchWalletBalances(rows, "polygon").map((row) => row.id), ["unpriced"]);
  assert.deepEqual(searchWalletBalances(rows, "base").map((row) => row.id), ["usdc-base", "eth-base"]);
  assert.deepEqual(searchWalletBalances(rows, "render").map((row) => row.id), ["renamed"]);
  assert.deepEqual(searchWalletBalances(rows, "nothing-like-this"), []);
});

test("the results group by chain, biggest first, with a total each", () => {
  const groups = groupWalletBalancesByChain(rows);
  assert.deepEqual(groups.map((group) => group.chain), ["base", "ethereum", "polygon"]);
  assert.deepEqual(groups.map((group) => group.label), ["Base", "Ethereum", "Polygon"]);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].valueUsd, 3_120);
  assert.equal(groups[1].valueUsd, 540);
  assert.equal(groups[2].valueUsd, 0);

  // Nothing is dropped: the groups hold exactly what went in.
  assert.equal(
    groups.reduce((sum, group) => sum + group.items.length, 0),
    rows.length,
  );

  // Two chains worth nothing fall back to the alphabet, so the order is stable.
  const flat = [
    { ...rows[4], id: "z", chain: "zora", chainLabel: "Zora" },
    { ...rows[4], id: "a", chain: "arbitrum", chainLabel: "Arbitrum" },
  ];
  assert.deepEqual(groupWalletBalancesByChain(flat).map((group) => group.label), ["Arbitrum", "Zora"]);

  // A single chain is still one group, never a special case.
  const one = groupWalletBalancesByChain([rows[0], rows[1]]);
  assert.equal(one.length, 1);
  assert.equal(one[0].items.length, 2);
});

test("the running total counts what has a price and ignores what does not", () => {
  assert.equal(walletValueUsd(rows), 3_660);
  assert.equal(walletValueUsd([]), 0);
  assert.equal(walletValueUsd([{ valueUsd: 0 }, { valueUsd: Number.NaN }, {}]), 0);
});

test("the picker searches, groups and totals with those helpers", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");

  assert.ok(dialog.includes("searchWalletBalances("), "the search box filters the cards");
  assert.ok(dialog.includes("groupWalletBalancesByChain("), "the results are grouped by chain");
  assert.ok(dialog.includes("walletValueUsd("), "and the ticked total is computed once");

  assert.ok(dialog.includes('placeholder="Search ticker, name or chain…"'), "there is a search box");
  assert.ok(dialog.includes("Clear the search"), "an empty search result explains itself");
  assert.ok(dialog.includes("Group by chain"), "grouping can be switched off");
  assert.ok(dialog.includes("Tick chain"), "a whole chain can be ticked at once");
  assert.ok(dialog.includes("walletChosenValue"), "the selected total is shown");
  // Select all / none act on what the search shows, not on everything.
  assert.ok(dialog.includes("for (const item of walletMatched) next.add(item.id)"));
  assert.ok(dialog.includes("for (const item of walletMatched) next.delete(item.id)"));
  // The cards are a responsive grid, not one long horizontal scroll.
  assert.ok(dialog.includes('grid max-h-[24rem] grid-cols-2'));
});
