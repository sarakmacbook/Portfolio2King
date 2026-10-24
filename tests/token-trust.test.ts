import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  OFFICIAL_CONTRACTS,
  contractStatusOf,
  normaliseEvmContract,
  officialContractOf,
} from "../src/lib/token-trust";
import {
  DEEP_LIQUIDITY_USD,
  MIN_LIQUIDITY_USD,
  MIN_ORGANIC_VOLUME_USD,
  fetchMarketSignals,
  isShallowLiquidity,
  liquidityDepth,
  shortUsd,
  signalsFromPairs,
} from "../src/lib/organic-volume";
import { depthOf, enrichTokenTrust, filterScanBalances } from "../src/lib/wallet-trust";

const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FAKE = "0x1111111111111111111111111111111111111111";

/** One DexScreener pair for `contract`. */
function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "ethereum",
    dexId: "uniswap",
    baseToken: { address: USDT_ETH, symbol: "USDT", name: "Tether USD" },
    quoteToken: { address: "0x0000000000000000000000000000000000000000", symbol: "WETH" },
    liquidity: { usd: 50_000 },
    volume: { h24: 10_000 },
    ...overrides,
  };
}

test("the official table matches the real contract, on the right chain", () => {
  assert.equal(normaliseEvmContract(USDT_ETH), USDT_ETH.toLowerCase());
  assert.equal(normaliseEvmContract("0x123"), null);
  assert.equal(normaliseEvmContract(null), null);

  // Official, whatever the case or chain spelling.
  assert.equal(
    contractStatusOf({ symbol: "USDT", contract: USDT_ETH, chain: "ethereum" }),
    "official",
  );
  assert.equal(
    contractStatusOf({ symbol: "usdt", contract: USDT_ETH.toLowerCase(), chain: "eth" }),
    "official",
    "DeBank's `eth` is the same chain as `ethereum`",
  );
  assert.equal(contractStatusOf({ symbol: "USDC", contract: USDC_BASE, chain: "base" }), "official");
  // Bridged variants are their own symbol, so they stay official rather than fake.
  assert.equal(
    contractStatusOf({
      symbol: "USDC.e",
      contract: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      chain: "base",
    }),
    "official",
  );

  // Same symbol, different contract: the impersonation case.
  assert.equal(contractStatusOf({ symbol: "USDT", contract: FAKE, chain: "ethereum" }), "different");
  // The real USDC address, but on the wrong chain, is not Base's USDC.
  assert.equal(
    contractStatusOf({
      symbol: "USDC",
      contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      chain: "base",
    }),
    "different",
  );

  // Anything the table cannot answer is unverified, never fake.
  assert.equal(contractStatusOf({ symbol: "WIF", contract: FAKE, chain: "ethereum" }), "unknown");
  assert.equal(contractStatusOf({ symbol: "USDT", contract: FAKE, chain: "zksync" }), "unknown");
  assert.equal(contractStatusOf({ symbol: "BTC", contract: null, chain: "bitcoin" }), "unknown");
  assert.equal(contractStatusOf({ symbol: "SOL", contract: "So11111111111111111111111111111111111111112", chain: "solana" }), "unknown");

  // LayerZero's OFT sits at one address on every chain it launched on.
  const ZRO = "0x6985884C4392D348587B19cb9eAAf157F13271cd";
  for (const chain of ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "eth", "arb"]) {
    assert.equal(
      contractStatusOf({ symbol: "ZRO", contract: ZRO, chain }),
      "official",
      `ZRO on ${chain}`,
    );
  }
  assert.equal(
    contractStatusOf({ symbol: "ZRO", contract: FAKE, chain: "base" }),
    "different",
    "a ZRO look-alike is caught",
  );

  assert.equal(officialContractOf("USDT", "ethereum"), USDT_ETH.toLowerCase());
  assert.equal(officialContractOf("NOPE", "ethereum"), null);
  // The table covers the chains the direct read prices.
  for (const chain of ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche"]) {
    assert.ok(OFFICIAL_CONTRACTS[chain], `${chain} is covered`);
  }
});

test("organic volume ignores dust pools and wash trading", () => {
  const real = signalsFromPairs([pair()], USDT_ETH);
  assert.equal(real.pairs, 1);
  assert.equal(real.dexes, 1);
  assert.equal(real.organicVolume24hUsd, 10_000);
  assert.equal(real.liquidityUsd, 50_000);
  assert.equal(real.hasMarket, true);
  assert.equal(real.washSuspected, false);

  // A pool with $10 of liquidity cannot prove $5,000 of genuine trading.
  const dustPool = signalsFromPairs(
    [pair({ liquidity: { usd: 10 }, volume: { h24: 5_000 } })],
    USDT_ETH,
  );
  assert.equal(dustPool.organicVolume24hUsd, 0);
  assert.equal(dustPool.hasMarket, false);
  assert.equal(dustPool.washSuspected, true);

  // Deep pool, impossible turnover.
  const wash = signalsFromPairs(
    [pair({ liquidity: { usd: 10_000 }, volume: { h24: 5_000_000 } })],
    USDT_ETH,
  );
  assert.equal(wash.organicVolume24hUsd, 0);
  assert.equal(wash.washSuspected, true);

  // Pairs for a different token are not this token's volume.
  const other = signalsFromPairs(
    [pair({ baseToken: { address: FAKE, symbol: "FAKE" } })],
    USDT_ETH,
  );
  assert.equal(other.pairs, 0);
  assert.equal(other.organicVolume24hUsd, 0);

  // Two real pools add up; two pools on one DEX still count as one DEX.
  const twoPools = signalsFromPairs(
    [pair(), pair({ liquidity: { usd: 20_000 }, volume: { h24: 4_000 } })],
    USDT_ETH,
  );
  assert.equal(twoPools.organicVolume24hUsd, 14_000);
  assert.equal(twoPools.liquidityUsd, 70_000);
  assert.equal(twoPools.dexes, 1);

  assert.deepEqual(signalsFromPairs([], USDT_ETH).organicVolume24hUsd, 0);

  // Depth: a $50,000 pool is deep, so the token reads as real.
  assert.equal(deepestOf([pair()]), 50_000);
  assert.equal(signalsFromPairs([pair()], USDT_ETH).deepLiquidity, true);
  assert.equal(signalsFromPairs([pair()], USDT_ETH).liquidityUsd, 50_000);

  // Money in a few shallow pools does not add up to depth.
  const manyShallow = signalsFromPairs(
    Array.from({ length: 6 }, () => ({ ...pair(), liquidity: { usd: 4_000 }, volume: { h24: 100 } })),
    USDT_ETH,
  );
  assert.equal(manyShallow.liquidityUsd, 24_000);
  assert.equal(manyShallow.deepestPoolUsd, 4_000);
  assert.equal(manyShallow.deepLiquidity, false, "no single pool holds real money");

  // One genuinely deep pool is enough, even without a crowd of pairs.
  const oneDeepPool = signalsFromPairs(
    [pair({ liquidity: { usd: DEEP_LIQUIDITY_USD + 1 }, volume: { h24: 500 } })],
    USDT_ETH,
  );
  assert.equal(oneDeepPool.deepLiquidity, true);
});

/** The deepest single pool of a fixture set. */
function deepestOf(pairs: unknown[]): number {
  return signalsFromPairs(pairs, USDT_ETH).deepestPoolUsd;
}

test("the liquidity depth verdict says real, thin or unknown", () => {
  assert.equal(isShallowLiquidity(undefined), false, "missing data is never shallow");
  assert.equal(isShallowLiquidity({ liquidityUsd: 0 }), true);
  assert.equal(isShallowLiquidity({ liquidityUsd: MIN_LIQUIDITY_USD - 1 }), true);
  assert.equal(isShallowLiquidity({ liquidityUsd: MIN_LIQUIDITY_USD }), false);

  assert.equal(liquidityDepth(undefined), "unknown");
  assert.equal(liquidityDepth({ liquidityUsd: 300, deepLiquidity: false }), "shallow");
  assert.equal(liquidityDepth({ liquidityUsd: 8_000, deepLiquidity: false }), "unknown");
  assert.equal(liquidityDepth({ liquidityUsd: 900_000, deepLiquidity: true }), "deep");

  // The balance-level helper used by the card.
  assert.equal(depthOf({}), "unknown");
  assert.equal(depthOf({ liquidityUsd: 120 }), "shallow");
  assert.equal(depthOf({ liquidityUsd: 80_000, deepLiquidity: true }), "deep");
  assert.equal(shortUsd(2_000), "$2.0k");
});

test("the market lookup is best-effort and batched", async () => {
  const urls: string[] = [];
  const mocked = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ pairs: [pair()] }), { status: 200 });
  }) as typeof fetch;

  const signals = await fetchMarketSignals([USDT_ETH, USDC_BASE], mocked);
  assert.equal(urls.length, 1, "one call for both contracts");
  assert.ok(urls[0].includes(USDT_ETH.toLowerCase()));
  assert.ok(urls[0].includes(USDC_BASE.toLowerCase()));
  assert.ok(urls[0].includes(","), "addresses are comma-joined");
  assert.equal(signals.get(USDT_ETH.toLowerCase())?.organicVolume24hUsd, 10_000);
  // DexScreener listed no pairs for the second contract: not traded there.
  assert.equal(signals.get(USDC_BASE.toLowerCase())?.pairs, 0);

  const failed = await fetchMarketSignals(
    [USDT_ETH],
    (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch,
  );
  assert.equal(failed.size, 0, "a rate limit is unknown, not zero");

  const thrown = await fetchMarketSignals(
    [USDT_ETH],
    (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
  );
  assert.equal(thrown.size, 0);
});

test("enrichTokenTrust adds the contract verdict and the volume, and never drops a balance", async () => {
  const mocked = (async () =>
    new Response(JSON.stringify({ pairs: [pair()] }), { status: 200 })) as typeof fetch;

  const balances = [
    { symbol: "USDT", name: "Tether USD", contract: USDT_ETH, chain: "ethereum" },
    { symbol: "USDT", name: "Tether USD", contract: FAKE, chain: "ethereum" },
    { symbol: "BTC", name: "Bitcoin", contract: null, chain: "bitcoin" },
  ];
  const enriched = await enrichTokenTrust(balances, mocked);
  assert.equal(enriched.length, 3);
  assert.equal(enriched[0].contractStatus, "official");
  assert.equal(enriched[0].organicVolumeUsd, 10_000);
  assert.equal(enriched[1].contractStatus, "different");
  assert.equal(enriched[2].contractStatus, "unknown");
  assert.equal(enriched[2].organicVolumeUsd, undefined);

  // A chain with no pairs at all is not indexed: keep its tokens "unknown".
  const uncovered = await enrichTokenTrust(
    [{ symbol: "SOMETHING", name: "Something", contract: FAKE, chain: "some-new-chain" }],
    (async () => new Response(JSON.stringify({ pairs: [] }), { status: 200 })) as unknown as typeof fetch,
  );
  assert.equal(uncovered[0].organicVolumeUsd, undefined, "an uncovered chain is not a dead market");
  assert.equal(uncovered[0].contractStatus, "unknown");

  const offline = await enrichTokenTrust(
    balances,
    (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
  );
  assert.equal(offline.length, 3, "a failed lookup keeps every balance");
  assert.equal(offline[0].contractStatus, "official", "the contract table is local");
  assert.equal(offline[0].organicVolumeUsd, undefined);
});

test("filterScanBalances separates look-alikes, spam, dead markets and dust", () => {
  const rows = [
    { id: "a", symbol: "USDT", name: "Tether USD", contract: USDT_ETH, chain: "ethereum", valueUsd: 500, organicVolumeUsd: 5_000_000 },
    // Fake USDT: right symbol, wrong contract, and a tempting value.
    { id: "b", symbol: "USDT", name: "Tether USD", contract: FAKE, chain: "ethereum", valueUsd: 40_000, organicVolumeUsd: 5_000_000 },
    { id: "c", symbol: "JUNK", name: "Claim your airdrop", contract: FAKE, chain: "ethereum", valueUsd: 200 },
    // Real token, no market at all.
    { id: "d", symbol: "NEW", name: "New Token", contract: FAKE, chain: "ethereum", valueUsd: 300, organicVolumeUsd: 0 },
    // Unknown volume and no price at all: kept, never filed as dust.
    { id: "e", symbol: "WIF", name: "dogwifhat", contract: FAKE, chain: "ethereum", valueUsd: 0, priced: false },
    // Traded a little, but the pools are shallow — a price without a market.
    { id: "g", symbol: "SHALLOW", name: "Shallow Pool", contract: FAKE, chain: "ethereum", valueUsd: 900, organicVolume24hUsd: 5_000, liquidityUsd: 300 },
    { id: "f", symbol: "USDC", name: "USD Coin", contract: USDC_BASE, chain: "base", valueUsd: 0.4, organicVolumeUsd: 9_000_000 },
  ];

  const split = filterScanBalances(rows, { dustCut: 1 });
  assert.deepEqual(split.kept.map((r) => r.id), ["a", "e"]);
  assert.deepEqual(split.impostor.map((r) => r.id), ["b"]);
  assert.deepEqual(split.spam.map((r) => r.id), ["c"]);
  assert.deepEqual(split.thin.map((r) => r.id), ["d", "g"]);
  assert.deepEqual(split.dust.map((r) => r.id), ["f"]);
  assert.equal(split.counts.total, 7);
  assert.equal(split.dustValue, 0.4);
  assert.equal(split.keptValue, 500);

  // Everything off: the scan is shown exactly as it came back.
  const all = filterScanBalances(rows, {
    hideSpam: false,
    hideImpostor: false,
    requireMarket: false,
    dustCut: 0,
  });
  assert.equal(all.kept.length, 7);
  assert.equal(all.counts.impostor + all.counts.spam + all.counts.thin + all.counts.dust, 0);

  // A stricter volume floor moves the mid-sized market out of "kept".
  const strict = filterScanBalances(rows, { dustCut: 0, minOrganicVolumeUsd: 20_000_000 });
  assert.ok(strict.thin.some((r) => r.id === "a"));
});

test("the scan route, the action and the dialog all use the trust checks", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes("enrichTokenTrust("), "the scan carries the verdicts");
  assert.ok(route.includes("balances,"), "the enriched balances are what the dialog gets");

  const actions = read("app/actions.ts");
  const body = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(body.includes("contractStatusOf("), "the server re-checks the contract itself");
  assert.ok(body.includes("skipImpostor"), "the switch is accepted");
  assert.ok(body.includes("skippedImpostor"), "the caller is told what was skipped");
  assert.ok(body.includes("minOrganicVolumeUsd"), "the volume floor is accepted");
  assert.ok(body.includes("skippedThin"), "and reported");
  assert.ok(body.includes('"different"'), "only a wrong contract is skipped, never an unknown one");

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("filterScanBalances("), "the picker uses the shared rules");
  assert.ok(dialog.includes("Hide look-alike contracts"), "the contract switch exists");
  assert.ok(dialog.includes("Only tokens with a real market"), "the market switch exists");
  assert.ok(dialog.includes("Import selected ("), "the button counts what is ticked");
  assert.ok(dialog.includes("toggleWalletChoice("), "each token can be deselected");
  assert.ok(dialog.includes("Select none"), "and the whole list at once");
  assert.ok(dialog.includes("official ✓"), "a matched contract is shown");
  assert.ok(dialog.includes("Skip tokens under"), "the dollar cut-off is still there");
  assert.ok(dialog.includes("minLiquidityUsd: walletRequireMarket ? MIN_LIQUIDITY_USD : 0"), "the depth floor reaches the server");
  assert.ok(dialog.includes("liq"), "the card shows the depth");
  assert.ok(dialog.includes("no price yet"), "an unpriced token says so instead of $0.00");

  const actionsBody = body;
  assert.ok(actionsBody.includes("price > 0 ? price : 0"), "an unpriced token is imported at 0, not $1");
  assert.ok(body.includes("minLiquidityUsd"), "the action accepts a depth floor");
  assert.ok(body.includes("skippedShallow"), "and reports what it skipped");
  assert.ok(MIN_ORGANIC_VOLUME_USD > 0 && MIN_LIQUIDITY_USD > MIN_ORGANIC_VOLUME_USD);
});
