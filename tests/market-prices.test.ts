import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  CEX_PROVIDERS,
  PRICE_PROVIDERS,
  describePriceSource,
  fetchPreferredMarketPrice,
  parsePriceSource,
  providerOrder,
} from "../src/lib/market-prices";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Minimal JSON response for the public tickers the providers call. */
function json(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as unknown as Response;
}

/** Routes a fake response by URL so a test can decide which exchanges answer. */
function stubFetch(handler: (url: string) => Response | null) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const response = handler(url);
    if (response) return response;
    return json({}, false, 404);
  }) as typeof fetch;
}

test("an asset's exchange is stored, normalised, and readable", () => {
  assert.deepEqual(CEX_PROVIDERS, ["bybit", "okx", "binance", "coinbase", "kraken"]);
  assert.equal(parsePriceSource("binance"), "binance");
  assert.equal(parsePriceSource(" Binance "), "binance");
  assert.equal(parsePriceSource("dexscreener"), "dexscreener");
  // Anything unknown is "no preference" — never an error on an import or a form.
  assert.equal(parsePriceSource(""), "");
  assert.equal(parsePriceSource(null), "");
  assert.equal(parsePriceSource(undefined), "");
  assert.equal(parsePriceSource("binanse"), "");
  assert.equal(parsePriceSource(42), "");

  assert.equal(describePriceSource("okx"), "OKX");
  assert.equal(describePriceSource(""), "Auto (any exchange)");
  assert.equal(describePriceSource("nope"), "Auto (any exchange)");
});

test("a pinned exchange is tried first, then the rest, without losing any provider", () => {
  assert.deepEqual(providerOrder(""), [...PRICE_PROVIDERS]);
  const pinned = providerOrder("okx");
  assert.equal(pinned[0], "okx");
  assert.equal(pinned.length, PRICE_PROVIDERS.length);
  assert.deepEqual([...pinned].sort(), [...PRICE_PROVIDERS].sort());
});

test("the pinned exchange answers first and is reported back", async () => {
  const calls: string[] = [];
  stubFetch((url) => {
    calls.push(url);
    if (url.includes("api.binance.com")) return json({ price: "61234.50" });
    return json({ price: "1" });
  });

  const result = await fetchPreferredMarketPrice("binance", "btc", "USDT");
  assert.deepEqual(result, { price: 61_234.5, provider: "binance" });
  assert.equal(calls.length, 1, "the pinned exchange answers on its own");
  assert.match(calls[0], /symbol=BTCUSDT/);
});

test("a pinned exchange that does not list the pair falls back to the others", async () => {
  const calls: string[] = [];
  stubFetch((url) => {
    calls.push(url);
    if (url.includes("api.binance.com")) return json({ msg: "Invalid symbol." }, false, 400);
    if (url.includes("api.bybit.com")) return json({ result: { list: [{ lastPrice: "0.5123" }] } });
    return json({}, false, 404);
  });

  const result = await fetchPreferredMarketPrice("binance", "XYZ", "USDT");
  assert.equal(result.provider, "bybit");
  assert.equal(result.price, 0.5123);
  assert.ok(calls.some((url) => url.includes("api.binance.com")), "the pinned exchange was tried first");
  assert.ok(calls.indexOf(calls.find((url) => url.includes("api.binance.com"))!) < calls.length);
});

test("without a preference any provider can answer, as before", async () => {
  stubFetch((url) => {
    if (url.includes("api.kraken.com")) {
      return json({ result: { XXBTZUSD: { c: ["43210.1"] } } });
    }
    return json({}, false, 503);
  });

  const result = await fetchPreferredMarketPrice("", "BTC", "USDT");
  assert.equal(result.provider, "kraken");
  assert.equal(result.price, 43_210.1);
});

test("no exchange pricing the symbol is a clear error, not a silent zero", async () => {
  stubFetch(() => json({}, false, 500));
  await assert.rejects(
    () => fetchPreferredMarketPrice("coinbase", "NOPE", "USD"),
    /No exchange returned a price for NOPE — Coinbase Exchange was tried first/,
  );
  await assert.rejects(() => fetchPreferredMarketPrice("", "NOPE"), /No exchange returned a price for NOPE/);
});
