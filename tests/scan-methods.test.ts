import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** `export const NAME = 123;` → 123 */
function numberConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `${name} is exported`);
  return Number(match[1].replace(/_/g, ""));
}

/** How many keys a `Record`-style table exports. */
function entryCount(source: string, name: string): number {
  const block = source.match(new RegExp(`export const ${name}[^{]*\\{(.*?)\\n\\};`, "s"));
  assert.ok(block, `${name} is exported`);
  return block[1]
    .split("\n")
    .filter((line) => /^\s*[\w"-]+:\s*[^,]+,\s*$/.test(line))
    .length;
}

test("the README documents every way a scan can find tokens", () => {
  const readme = read("README.md");
  assert.ok(readme.includes("### How a scan finds tokens"), "the section exists");

  // One row per address kind, each naming the provider it uses.
  for (const method of [
    "DeBank",
    "Blockscout",
    "Routescan",
    "solana-rpc.publicnode.com",
    "mempool.space",
    "blockstream.info",
    "tronscanapi.com",
  ]) {
    assert.ok(readme.includes(method), `the README names ${method}`);
  }
  for (const kind of ["`0x…` (EVM)", "Solana", "Bitcoin", "Tron"]) {
    assert.ok(readme.includes(kind), `the README covers ${kind}`);
  }

  // And the trust pass that runs after the read.
  assert.ok(readme.includes("Trust pass"), "the contract/volume/depth pass is documented");
  assert.ok(readme.includes("DexScreener"), "including where the market data comes from");
});

test("the documented limits are the ones in the code", () => {
  const readme = read("README.md");

  const discovered = read("src/lib/discovered-tokens.ts");
  const perChain = numberConstant(discovered, "MAX_DISCOVERED_TOKENS");
  assert.ok(readme.includes(`${perChain} per\n   chain`) || readme.includes(`${perChain} tokens per`), `the ${perChain}-token explorer cap is documented`);

  const debank = read("src/lib/debank.ts");
  const debankCap = numberConstant(debank, "MAX_DEBANK_TOKENS");
  assert.ok(readme.includes(`at most ${debankCap} tokens`) || readme.includes(`${debankCap} tokens`), `the ${debankCap}-token DeBank cap is documented`);

  const routescan = read("src/lib/routescan.ts");
  const pageSize = numberConstant(routescan, "ROUTESCAN_PAGE_SIZE");
  const pages = numberConstant(routescan, "ROUTESCAN_MAX_PAGES");
  assert.ok(readme.includes(`two pages of ${pageSize}`), `the ${pages}×${pageSize} Routescan paging is documented`);

  // The chain counts in the tables match the prose.
  const blockscoutCount = entryCount(read("src/lib/blockscout.ts"), "BLOCKSCOUT_INSTANCES");
  assert.ok(readme.includes(`${blockscoutCount} Blockscout`), `${blockscoutCount} Blockscout chains documented`);

  const routescanCount = entryCount(routescan, "ROUTESCAN_CHAIN_IDS");
  assert.ok(readme.includes(`${routescanCount} Routescan`), `${routescanCount} Routescan chains documented`);
});

test("the dialog explains the method in the app, not only in the README", () => {
  const dialog = read("src/components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("How the scan finds tokens"), "the panel exists");
  assert.ok(dialog.includes("<details"), "and it collapses");
  for (const method of ["DeBank", "Blockscout", "Routescan", "mempool.space", "Tronscan", "DexScreener"]) {
    assert.ok(dialog.includes(method), `the panel names ${method}`);
  }
  assert.ok(
    dialog.includes("only when"),
    "the panel says the chains are read only when the chosen source cannot answer",
  );
  assert.ok(dialog.includes("Limits"), "and the caps are stated");
});

test("the scan route still runs the method the docs describe", () => {
  const scanner = read("src/lib/wallet-scanner.ts");
  assert.ok(scanner.includes("const readDirect = ()"), "the direct read is the fallback");
  assert.ok(scanner.includes("discoverChainTokens("), "explorer discovery is part of the direct read");
  assert.ok(scanner.includes("priceBalances("), "unpriced tokens get a price");
  assert.ok(scanner.includes("fromIndex("), "index rows go through the same pricing");

  const route = read("src/app/api/wallet/scan/route.ts");
  assert.ok(route.includes("scanWalletAddress("), "the route reads balances first");
  assert.ok(route.includes("enrichTokenTrust("), "then verifies contracts and markets");
});
