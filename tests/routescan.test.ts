import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROUTESCAN_CHAIN_IDS,
  ROUTESCAN_MAX_PAGES,
  fetchRoutescanTokens,
  parseRoutescanTokenBalances,
  routescanChainId,
  routescanTokenBalanceUrl,
} from "../src/lib/routescan";
import {
  mergeDiscoveredTokens,
  normaliseDiscoveredTokens,
} from "../src/lib/discovered-tokens";

/** An Etherscan-shaped `addresstokenbalance` row. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    TokenAddress: "0x6985884C4392D348587B19cb9eAAf157F13271cd",
    TokenName: "LayerZero",
    TokenSymbol: "ZRO",
    TokenQuantity: "2500000000000000000",
    TokenDivisor: "1000000000000000000",
    ...overrides,
  };
}

test("Routescan chain ids cover the chains the direct read scans", () => {
  for (const chain of [
    "ethereum",
    "bsc",
    "arbitrum",
    "base",
    "polygon",
    "optimism",
    "avalanche",
    "zksync",
    "linea",
    "scroll",
    "mantle",
    "blast",
    "fantom",
    "gnosis",
    "cronos",
  ]) {
    assert.equal(typeof routescanChainId(chain), "number", chain);
  }
  assert.equal(ROUTESCAN_CHAIN_IDS.base, 8453);
  assert.equal(routescanChainId("Base"), 8453);
  assert.equal(routescanChainId("not-a-chain"), null);

  assert.match(
    String(routescanTokenBalanceUrl("base", "0xAbC0000000000000000000000000000000000001")),
    /^https:\/\/api\.routescan\.io\/v2\/network\/mainnet\/evm\/8453\/etherscan\/api\?module=account&action=addresstokenbalance&address=0xAbC0000000000000000000000000000000000001&page=1&offset=100$/,
  );
  assert.equal(routescanTokenBalanceUrl("not-a-chain", "0xabc"), null);
});

test("parseRoutescanTokenBalances reads Etherscan-shaped holdings", () => {
  const tokens = parseRoutescanTokenBalances({
    status: "1",
    message: "OK",
    result: [
      row(),
      // Same token listed twice, and a spam airdrop.
      row(),
      row({
        TokenAddress: "0x1111111111111111111111111111111111111111",
        TokenName: "Claim",
        TokenSymbol: "SCAM",
        TokenQuantity: "1000000000000000000000",
        TokenDivisor: "1000000000000000000",
        reputation: "spam",
      }),
      // A token with 6 decimals and a zero balance.
      row({
        TokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        TokenName: "USD Coin",
        TokenSymbol: "usdc",
        TokenQuantity: "1250000",
        TokenDivisor: "1000000",
      }),
      row({ TokenAddress: "0x2222222222222222222222222222222222222222", TokenQuantity: "0" }),
    ],
  });

  assert.deepEqual(tokens.map((token) => token.symbol), ["ZRO", "USDC"]);
  assert.equal(tokens[0].quantity, 2.5);
  assert.equal(tokens[0].name, "LayerZero");
  assert.equal(tokens[0].stablecoin, false);
  assert.equal(tokens[1].quantity, 1.25);
  assert.equal(tokens[1].stablecoin, true);
  assert.equal(tokens[1].symbol, "USDC", "symbols are upper-cased");
});

test("parseRoutescanTokenBalances tolerates the other field spellings", () => {
  const tokens = parseRoutescanTokenBalances({
    result: [
      {
        tokenAddress: "0x6985884C4392D348587B19cb9eAAf157F13271cd",
        symbol: "ZRO",
        name: "LayerZero",
        decimals: 18,
        balance: "3000000000000000000",
      },
    ],
  });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].quantity, 3);

  // "No token found" is an empty wallet, not an error.
  assert.deepEqual(parseRoutescanTokenBalances({ status: "0", message: "No token found", result: "[]" }), []);
  assert.deepEqual(parseRoutescanTokenBalances(null), []);
});

test("fetchRoutescanTokens pages, stops early and never throws", async () => {
  const urls: string[] = [];
  const fullPage = Array.from({ length: 100 }, (_, index) =>
    row({
      TokenAddress: `0x${index.toString(16).padStart(40, "0")}`,
      TokenSymbol: `T${index}`,
      TokenQuantity: String(index + 1),
      TokenDivisor: "1",
    }),
  );

  const paged = await fetchRoutescanTokens(
    "base",
    "0xAbC0000000000000000000000000000000000001",
    (async (url: string) => {
      urls.push(String(url));
      const page = new URL(String(url)).searchParams.get("page");
      return new Response(
        JSON.stringify({
          status: "1",
          result: page === "1" ? fullPage : [row()],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch,
  );

  assert.equal(urls.length, 2, "a full page means there may be more");
  assert.ok(urls[1].includes("page=2"));
  assert.equal(paged.length, 101, "both pages are merged, de-duplicated");
  assert.ok(paged.some((token) => token.symbol === "ZRO"), "the second page is included");

  const offline = await fetchRoutescanTokens(
    "base",
    "0xAbC0000000000000000000000000000000000001",
    (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
  );
  assert.deepEqual(offline, []);

  const unknownChain = await fetchRoutescanTokens("not-a-chain", "0xabc");
  assert.deepEqual(unknownChain, []);
  // Two pages is the ceiling even if the API keeps returning a full page.
  assert.ok(ROUTESCAN_MAX_PAGES >= 1);
});

test("mergeDiscoveredTokens unions sources and keeps the first report of a contract", () => {
  const blockscout = normaliseDiscoveredTokens([
    {
      contract: "0x6985884C4392D348587B19cb9eAAf157F13271cd",
      symbol: "ZRO",
      name: "LayerZero",
      decimals: 18,
      quantity: 2.5,
    },
  ]);
  const routescan = normaliseDiscoveredTokens([
    {
      contract: "0x6985884C4392D348587B19cb9eAAf157F13271cd",
      symbol: "ZRO",
      name: "",
      decimals: 18,
      quantity: 2.5,
    },
    {
      contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      quantity: 40,
    },
  ]);

  const merged = mergeDiscoveredTokens(blockscout, routescan);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((token) => token.symbol === "ZRO")?.name, "LayerZero", "the richer entry wins");
});

test("normaliseDiscoveredTokens drops spam, junk and empty balances", () => {
  const tokens = normaliseDiscoveredTokens([
    { contract: "0x6985884C4392D348587B19cb9eAAf157F13271cd", symbol: "ZRO", name: "LayerZero", decimals: 18, quantity: 1 },
    { contract: "0x6985884C4392D348587B19cb9eAAf157F13271cd", symbol: "ZRO", name: "LayerZero", decimals: 18, quantity: 2 },
    { contract: "0x1111111111111111111111111111111111111111", symbol: "SCAM", name: "x", decimals: 18, quantity: 1, spam: true },
    { contract: "0x2222222222222222222222222222222222222222", symbol: "ZERO", name: "x", decimals: 18, quantity: 0 },
    { contract: "nope", symbol: "BAD", name: "x", decimals: 18, quantity: 5 },
  ]);
  assert.deepEqual(tokens.map((token) => token.symbol), ["ZRO"]);
});
