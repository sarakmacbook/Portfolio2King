import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "../src/app/api/prices/top/route";
import {
  CryptoSearchError,
  getTopCryptoAssets,
  resetCryptoSearchState,
  searchCryptoAssets,
} from "../src/lib/crypto-search";

type Route = { match: RegExp; respond: (url: string) => Response | Promise<Response> };

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function installFetch(routes: Route[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) return jsonResponse({ error: "unexpected url" }, 500);
    return route.respond(url);
  }) as typeof fetch;
  return calls;
}

const COINGECKO_MARKETS = [
  { id: "bitcoin", name: "Bitcoin", symbol: "btc", current_price: 68000, market_cap_rank: 1 },
  { id: "ethereum", name: "Ethereum", symbol: "eth", current_price: 3200, market_cap_rank: 2 },
];

const PAPRIKA_SEARCH = {
  currencies: [
    { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, is_active: true },
    { id: "bch-bitcoin-cash", name: "Bitcoin Cash", symbol: "BCH", rank: 16, is_active: true },
  ],
};

const PAPRIKA_TICKERS: Record<string, unknown> = {
  "btc-bitcoin": {
    id: "btc-bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    rank: 1,
    quotes: { USD: { price: 67950.12 } },
  },
  "bch-bitcoin-cash": {
    id: "bch-bitcoin-cash",
    name: "Bitcoin Cash",
    symbol: "BCH",
    rank: 16,
    quotes: { USD: { price: 452.5 } },
  },
};

beforeEach(() => resetCryptoSearchState());
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetCryptoSearchState();
});

test("search falls back to CoinPaprika when CoinGecko is rate-limited", async () => {
  const calls = installFetch([
    { match: /api\.coingecko\.com\/api\/v3\/search/, respond: () => jsonResponse({ error: "rate limited" }, 429) },
    { match: /api\.coinpaprika\.com\/v1\/search/, respond: () => jsonResponse(PAPRIKA_SEARCH) },
    {
      match: /api\.coinpaprika\.com\/v1\/tickers\/([\w-]+)/,
      respond: (url) => {
        const id = /tickers\/([\w-]+)/.exec(url)?.[1] ?? "";
        return jsonResponse(PAPRIKA_TICKERS[id] ?? {});
      },
    },
  ]);

  const result = await searchCryptoAssets("bitcoin");
  assert.equal(result.source, "coinpaprika");
  assert.equal(result.assets.length, 2);
  assert.deepEqual(result.assets[0], {
    id: "btc-bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    price: 67950.12,
    rank: 1,
    chain: null,
    contract: null,
  });
  assert.deepEqual(result.assets.map((asset) => asset.symbol), ["BTC", "BCH"]);
  assert.deepEqual(result.assets.map((asset) => asset.price), [67950.12, 452.5]);
  assert.ok(calls.some((url) => url.includes("coingecko")));
  assert.ok(calls.some((url) => url.includes("coinpaprika")));
});

test("search uses CoinGecko when it answers", async () => {
  const calls = installFetch([
    { match: /api\.coingecko\.com\/api\/v3\/search/, respond: () => jsonResponse({ coins: [{ id: "bitcoin" }] }) },
    { match: /api\.coingecko\.com\/api\/v3\/coins\/markets/, respond: () => jsonResponse(COINGECKO_MARKETS) },
  ]);

  const result = await searchCryptoAssets("btc");
  assert.equal(result.source, "coingecko");
  assert.deepEqual(result.assets.map((asset) => asset.symbol), ["BTC", "ETH"]);
  assert.equal(calls.length, 2);
});

test("search falls through to DexScreener when both indexes are limited", async () => {
  installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse({ error: "limited" }, 429) },
    { match: /api\.coinpaprika\.com/, respond: () => jsonResponse({ error: "limited" }, 402) },
    {
      match: /api\.dexscreener\.com\/latest\/dex\/search/,
      respond: () =>
        jsonResponse({
          pairs: [
            {
              chainId: "ethereum",
              baseToken: { address: "0x1111111111111111111111111111111111111111", name: "Pepe", symbol: "PEPE" },
              priceUsd: "0.0000123",
              liquidity: { usd: 2_000_000 },
            },
            {
              chainId: "base",
              baseToken: { address: "0x2222222222222222222222222222222222222222", name: "Pepe", symbol: "PEPE" },
              priceUsd: "0.0000124",
              liquidity: { usd: 500_000 },
            },
            {
              // Deep liquidity but unrelated to the query — relevance wins.
              chainId: "ethereum",
              baseToken: { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", name: "Wrapped Ether", symbol: "WETH" },
              priceUsd: "3200",
              liquidity: { usd: 50_000_000 },
            },
          ],
        }),
    },
  ]);

  const result = await searchCryptoAssets("pepe");
  assert.equal(result.source, "dexscreener");
  assert.equal(result.assets.length, 2);
  // Highest-liquidity pair first.
  assert.equal(result.assets[0].price, 0.0000123);
  assert.equal(result.assets[0].chain, "ethereum");
  assert.equal(result.assets[0].contract, "0x1111111111111111111111111111111111111111");
});

test("search reports rate limiting when every provider is limited", async () => {
  installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse({}, 429) },
    { match: /api\.coinpaprika\.com/, respond: () => jsonResponse({}, 429) },
    { match: /api\.dexscreener\.com/, respond: () => jsonResponse({}, 429) },
  ]);

  await assert.rejects(searchCryptoAssets("btc"), (error: unknown) => {
    assert.ok(error instanceof CryptoSearchError);
    assert.equal(error.status, 429);
    assert.match(error.message, /rate-limited/i);
    return true;
  });
});

test("a rate-limited provider is skipped on the next request", async () => {
  const calls = installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse({}, 429) },
    { match: /api\.coinpaprika\.com\/v1\/search/, respond: () => jsonResponse(PAPRIKA_SEARCH) },
    { match: /api\.coinpaprika\.com\/v1\/tickers\//, respond: () => jsonResponse(PAPRIKA_TICKERS["btc-bitcoin"]) },
  ]);

  await searchCryptoAssets("bitcoin");
  const afterFirst = calls.length;
  assert.ok(calls.some((url) => url.includes("coingecko")));

  resetCacheOnly();
  const second = await searchCryptoAssets("bitcoin cash");
  assert.equal(second.source, "coinpaprika");
  assert.ok(
    !calls.slice(afterFirst).some((url) => url.includes("coingecko")),
    "CoinGecko should be skipped while its cooldown is active",
  );
});

test("identical searches are served from the in-process cache", async () => {
  const calls = installFetch([
    { match: /api\.coingecko\.com\/api\/v3\/search/, respond: () => jsonResponse({ coins: [{ id: "bitcoin" }] }) },
    { match: /api\.coingecko\.com\/api\/v3\/coins\/markets/, respond: () => jsonResponse(COINGECKO_MARKETS) },
  ]);

  await searchCryptoAssets("bitcoin");
  const first = calls.length;
  await searchCryptoAssets("  BITCOIN  ");
  assert.equal(calls.length, first);
});

test("top assets fall back to CoinPaprika and stay sorted by market-cap rank", async () => {
  const tickers = [
    { id: "eth-ethereum", name: "Ethereum", symbol: "ETH", rank: 2, quotes: { USD: { price: 3200 } } },
    { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, quotes: { USD: { price: 68000 } } },
    { id: "zzz-inactive", name: "Inactive", symbol: "ZZZ", rank: 0, quotes: { USD: { price: 1 } } },
    { id: "nocash", name: "No price", symbol: "NOP", rank: 9, quotes: { USD: { price: null } } },
  ];
  installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse({}, 429) },
    { match: /api\.coinpaprika\.com\/v1\/tickers\?quotes=USD/, respond: () => jsonResponse(tickers) },
  ]);

  const result = await getTopCryptoAssets();
  assert.equal(result.source, "coinpaprika");
  assert.deepEqual(result.assets.map((asset) => asset.symbol), ["BTC", "ETH"]);
  assert.deepEqual(result.assets.map((asset) => asset.rank), [1, 2]);
});

test("top assets fall back to Binance USDT markets when the indexes are down", async () => {
  installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse({}, 429) },
    { match: /api\.coinpaprika\.com/, respond: () => jsonResponse({}, 429) },
    {
      match: /api\.binance\.com\/api\/v3\/ticker\/24hr/,
      respond: () =>
        jsonResponse([
          { symbol: "BTCUSDT", lastPrice: "68000", quoteVolume: "900000000" },
          { symbol: "ETHUSDT", lastPrice: "3200", quoteVolume: "500000000" },
          { symbol: "PEPEUSDT", lastPrice: "0.0000123", quoteVolume: "120000000" },
          { symbol: "USDCUSDT", lastPrice: "1.0001", quoteVolume: "999000000" },
        ]),
    },
  ]);

  const result = await getTopCryptoAssets();
  assert.equal(result.source, "binance");
  assert.deepEqual(result.assets.map((asset) => asset.symbol), ["BTC", "ETH", "PEPE"]);
  assert.equal(result.assets[0].price, 68000);
  assert.equal(result.assets[0].rank, null);
});

test("contract lookups query DexScreener only and filter the exact address", async () => {
  const contract = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";
  const calls = installFetch([
    {
      match: /api\.dexscreener\.com\/latest\/dex\/tokens\//,
      respond: () =>
        jsonResponse({
          pairs: [
            {
              chainId: "ethereum",
              baseToken: { address: contract, name: "Pepe", symbol: "PEPE" },
              priceUsd: "0.0000123",
              liquidity: { usd: 500 },
            },
            {
              chainId: "ethereum",
              baseToken: { address: "0x0000000000000000000000000000000000000001", name: "Other", symbol: "OTH" },
              priceUsd: "1.5",
              liquidity: { usd: 90000000 },
            },
          ],
        }),
    },
  ]);

  const result = await searchCryptoAssets(contract);
  assert.equal(result.source, "dexscreener");
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].symbol, "PEPE");
  assert.equal(result.assets[0].contract, contract);
  assert.ok(calls.every((url) => url.includes("dexscreener")));
});

test("malformed provider payloads do not crash a search", async () => {
  installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse("not-an-object") },
    { match: /api\.coinpaprika\.com/, respond: () => jsonResponse({ currencies: ["nope"] }) },
    { match: /api\.dexscreener\.com/, respond: () => jsonResponse({ pairs: [{ baseToken: null }] }) },
  ]);

  const result = await searchCryptoAssets("weird-token");
  assert.deepEqual(result.assets, []);
});

test("an empty query falls back to the top-assets provider chain", async () => {
  installFetch([
    { match: /api\.coingecko\.com\/api\/v3\/coins\/markets/, respond: () => jsonResponse(COINGECKO_MARKETS) },
  ]);

  const result = await getTopCryptoAssets();
  assert.equal(result.source, "coingecko");
  assert.equal(result.assets.length, 2);
});

/** Clears only the result cache so a provider cooldown stays in place. */
function resetCacheOnly() {
  const state = (globalThis as typeof globalThis & {
    __ledgerlyCryptoSearch?: { cache: Map<string, unknown>; cooldowns: Map<string, number> };
  }).__ledgerlyCryptoSearch;
  state?.cache.clear();
}

test("the search route reports the provider that answered", async () => {
  installFetch([
    { match: /api\.coingecko\.com/, respond: () => jsonResponse({}, 429) },
    { match: /api\.coinpaprika\.com\/v1\/search/, respond: () => jsonResponse(PAPRIKA_SEARCH) },
    {
      match: /api\.coinpaprika\.com\/v1\/tickers\/([\w-]+)/,
      respond: (url) => jsonResponse(PAPRIKA_TICKERS[/tickers\/([\w-]+)/.exec(url)?.[1] ?? ""] ?? {}),
    },
  ]);

  const response = await GET(new Request("http://app.test/api/prices/top?q=bitcoin"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as { source?: string; query?: string; assets?: Array<{ symbol: string }> };
  assert.equal(body.source, "coinpaprika");
  assert.equal(body.query, "bitcoin");
  assert.deepEqual(body.assets?.map((asset) => asset.symbol), ["BTC", "BCH"]);
});

test("the search route maps exhausted rate limits to HTTP 429", async () => {
  installFetch([{ match: /./, respond: () => jsonResponse({ error: "limited" }, 429) }]);

  const response = await GET(new Request("http://app.test/api/prices/top?q=bitcoin"));
  assert.equal(response.status, 429);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /rate-limited/i);
});

test("the search route serves top assets without a query", async () => {
  installFetch([
    { match: /api\.coingecko\.com\/api\/v3\/coins\/markets/, respond: () => jsonResponse(COINGECKO_MARKETS) },
  ]);

  const response = await GET(new Request("http://app.test/api/prices/top"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { source?: string; assets?: Array<{ symbol: string }> };
  assert.equal(body.source, "coingecko");
  assert.deepEqual(body.assets?.map((asset) => asset.symbol), ["BTC", "ETH"]);
});
