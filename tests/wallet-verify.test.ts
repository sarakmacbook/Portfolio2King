import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  VERIFIED_DEEPEST_POOL_USD,
  VERIFIED_LIQUIDITY_USD,
  enrichTokenTrust,
  filterScanBalances,
  verificationOf,
  verifiedByOf,
} from "../src/lib/wallet-trust";
import { parseBlockscanTokenTransfers } from "../src/lib/blockscan";
import { parseMoralisTokens } from "../src/lib/moralis";
import { parseBlockscoutTokenBalances } from "../src/lib/blockscout";

const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const FAKE = "0x1111111111111111111111111111111111111111";
const JUNK = "0x2222222222222222222222222222222222222222";

/** A DexScreener pair, the shape `fetchMarketSignals` reads. */
function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "ethereum",
    dexId: "uniswap",
    baseToken: { address: JUNK, symbol: "JUNK", name: "Junk Token" },
    quoteToken: { address: "0x0000000000000000000000000000000000000000", symbol: "WETH" },
    liquidity: { usd: 40_000 },
    volume: { h24: 20_000 },
    ...overrides,
  };
}

test("verification needs positive evidence, and never guesses", () => {
  // The contract table is local and definitive.
  assert.equal(verificationOf({ symbol: "USDT", contract: USDT_ETH, chain: "ethereum" }), "verified");

  // An indexer's own verdict counts, even with no market data at all.
  assert.equal(verificationOf({ symbol: "NEW", contract: FAKE, chain: "ethereum", verified: true }), "verified");

  // A spam verdict is the one thing that is actively "not real".
  assert.equal(verificationOf({ symbol: "JUNK", contract: JUNK, chain: "ethereum", spam: true }), "unverified");

  // Nothing known at all stays unknown — missing data never hides a holding.
  assert.equal(verificationOf({ symbol: "?", contract: JUNK, chain: "ethereum" }), "unknown");

  // A deep market is proof: real money, real volume.
  assert.equal(
    verificationOf({
      symbol: "JUNK",
      contract: JUNK,
      chain: "ethereum",
      liquidityUsd: VERIFIED_LIQUIDITY_USD,
      deepestPoolUsd: VERIFIED_DEEPEST_POOL_USD,
      organicVolumeUsd: 5_000,
    }),
    "verified",
  );
  // ...and one dollar less of depth is not.
  assert.equal(
    verificationOf({
      symbol: "JUNK",
      contract: JUNK,
      chain: "ethereum",
      liquidityUsd: VERIFIED_LIQUIDITY_USD - 1,
      deepestPoolUsd: VERIFIED_DEEPEST_POOL_USD,
      organicVolumeUsd: 5_000,
    }),
    "unverified",
  );
  // Deep liquidity but nobody trades it: a price with no market behind it.
  assert.equal(
    verificationOf({
      symbol: "JUNK",
      contract: JUNK,
      chain: "ethereum",
      liquidityUsd: 1_000_000,
      deepestPoolUsd: 500_000,
      organicVolumeUsd: 0,
    }),
    "unverified",
  );
  // Twenty dust pools are not depth.
  assert.equal(
    verificationOf({
      symbol: "JUNK",
      contract: JUNK,
      chain: "ethereum",
      liquidityUsd: 1_000_000,
      deepestPoolUsd: 100,
      organicVolumeUsd: 5_000,
    }),
    "unverified",
  );

  // The label the UI can show, for a verified row.
  const reasons = verifiedByOf({
    symbol: "JUNK",
    contract: JUNK,
    chain: "ethereum",
    liquidityUsd: 100_000,
    deepestPoolUsd: 50_000,
  });
  assert.deepEqual(reasons, ["deep market"]);
});

test("a scan carries the verdict for every balance, including unverifiable ones", async () => {
  // DexScreener knows one deep market and nothing for the junk contract.
  const mocked = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const pairs = url.includes(JUNK.toLowerCase())
      ? [pair(), pair({ liquidity: { usd: 60_000 }, volume: { h24: 30_000 } })]
      : [pair({ baseToken: { address: USDT_ETH, symbol: "USDT", name: "Tether USD" } })];
    return new Response(JSON.stringify({ pairs }), { status: 200 });
  }) as unknown as typeof fetch;

  const enriched = await enrichTokenTrust(
    [
      { symbol: "USDT", name: "Tether USD", contract: USDT_ETH, chain: "ethereum" },
      { id: "junk", symbol: "JUNK", name: "Junk Token", contract: JUNK, chain: "ethereum" },
      { id: "other", symbol: "OTHER", name: "Other", contract: FAKE, chain: "ethereum" },
      { id: "btc", symbol: "BTC", name: "Bitcoin", contract: null, chain: "bitcoin" },
    ],
    mocked,
  );

  assert.equal(enriched.length, 4, "nothing is dropped");
  assert.equal(enriched[0].verification, "verified", "the official contract");
  assert.equal(enriched[1].verification, "verified", "a deep market");
  assert.deepEqual(enriched[1].verifiedBy, ["deep market"]);
  assert.equal(enriched[2].verification, "unverified", "no pairs on an indexed chain");
  assert.equal(enriched[3].verification, "unknown", "a chain with no market data");

  // Offline: every balance still leaves with a verdict, none of them hidden.
  const offline = await enrichTokenTrust(
    [{ symbol: "JUNK", name: "Junk", contract: JUNK, chain: "ethereum" }],
    (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
  );
  assert.equal(offline[0].verification, "unknown");
});

test("the strict filter hides only what was positively judged not real", () => {
  const rows = [
    { id: "ok", symbol: "USDT", name: "Tether USD", contract: USDT_ETH, chain: "ethereum", valueUsd: 500, verification: "verified" as const },
    { id: "junk", symbol: "JUNK", name: "Junk Token", contract: JUNK, chain: "ethereum", valueUsd: 400, verification: "unverified" as const },
    { id: "unknown", symbol: "NEW", name: "New Token", contract: FAKE, chain: "ethereum", valueUsd: 300, verification: "unknown" as const },
    { id: "bare", symbol: "BARE", name: "Bare", contract: FAKE, chain: "ethereum", valueUsd: 200 },
  ];

  const strict = filterScanBalances(rows, { dustCut: 0 });
  assert.deepEqual(strict.kept.map((row) => row.id), ["ok", "unknown", "bare"]);
  assert.deepEqual(strict.unverified.map((row) => row.id), ["junk"]);
  assert.equal(strict.counts.unverified, 1);

  // The switch is the user's: off, and the junk is shown like everything else.
  const relaxed = filterScanBalances(rows, { dustCut: 0, requireVerified: false });
  assert.deepEqual(relaxed.kept.map((row) => row.id), ["ok", "junk", "unknown", "bare"]);
  assert.equal(relaxed.counts.unverified, 0);
});

test("every source's verification verdict is read, and Blockscan's bait is flagged", () => {
  // Moralis: verified_contract.
  const moralis = parseMoralisTokens(
    {
      result: [
        {
          token_address: USDT_ETH,
          symbol: "USDT",
          name: "Tether USD",
          decimals: 6,
          balance_formatted: "10",
          verified_contract: true,
          possible_spam: false,
          usd_price: 1,
        },
      ],
    },
    { chain: "ethereum", label: "Ethereum" },
  );
  assert.equal(moralis[0].verified, true);

  // Blockscout: reputation === "verified".
  const blockscout = parseBlockscoutTokenBalances([
    {
      token: { address_hash: USDT_ETH, symbol: "USDT", name: "Tether USD", decimals: "6", reputation: "verified", type: "ERC-20" },
      value: "10000000",
    },
  ]);
  assert.equal(blockscout[0].verified, true);

  // Blockscan transfers: junk names carry the spam flag, because Etherscan sends
  // no reputation verdict on the free endpoints.
  const transfers = parseBlockscanTokenTransfers({
    result: [
      {
        contractAddress: JUNK,
        tokenName: "Visit claim-junk.io to claim 5000 USDT",
        tokenSymbol: "USDT",
        tokenDecimal: "6",
      },
    ],
  });
  assert.equal(transfers.length, 1, "the row itself is kept — the picker decides");
  assert.equal(transfers[0].symbol, "USDT");
});

test("the dialog, the import action and the scan all use the new rule", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("requireVerified: walletRequireVerified"), "the picker applies it");
  assert.ok(dialog.includes("Only real tokens"), "the switch is visible");
  assert.ok(dialog.includes("walletSelection.counts.unverified"), "and counted");
  assert.ok(dialog.includes("setWalletRequireVerified(false)"), "with a way back");
  assert.ok(dialog.includes("skipUnverified: walletRequireVerified"), "the import re-checks it");
  assert.equal(
    /useState\(true\);[^\n]*\n[^\n]*const \[walletRequireVerified, setWalletRequireVerified\] = useState\(false\)/.test(dialog),
    false,
    "verification is on by default",
  );
  assert.ok(
    dialog.includes("const [walletRequireVerified, setWalletRequireVerified] = useState(true)"),
    "verification is on by default",
  );

  const actions = read("app/actions.ts");
  assert.ok(actions.includes("skipUnverified"), "the server accepts the switch");
  assert.ok(actions.includes("skippedUnverified"), "and reports what it skipped");
  assert.ok(actions.includes("verificationOf("), "from the same rules, not a client flag");

  const scanner = read("lib/wallet-scanner.ts");
  assert.ok(scanner.includes("verified?: boolean"), "the scan carries the indexer verdict");
  const blockscan = read("lib/blockscan.ts");
  assert.ok(blockscan.includes("isSpamToken({ name: ref.name, symbol: ref.symbol })"), "bait is flagged");
});
