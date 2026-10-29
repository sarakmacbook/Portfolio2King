import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/prices/live/route";
import { cryptoRefreshTargets } from "../src/lib/portfolio";
import { isRealtimeCryptoCategory } from "../src/lib/stablecoins";

test("real-time updates apply to volatile crypto only", () => {
  assert.equal(isRealtimeCryptoCategory("volatile"), true);
  assert.equal(isRealtimeCryptoCategory("stablecoin"), false);
  // An unknown or missing category keeps the old behaviour: fetch it.
  assert.equal(isRealtimeCryptoCategory(undefined), true);
  assert.equal(isRealtimeCryptoCategory(null), true);
});

test("real-time refresh targets drop stablecoins only for real-time runs", () => {
  const crypto = [
    { cryptoCategory: "volatile" as const },
    { cryptoCategory: "stablecoin" as const },
    { cryptoCategory: "volatile" as const },
  ];
  // Background timer (real-time): stablecoins keep their stored price.
  assert.deepEqual(cryptoRefreshTargets(crypto, true), [
    { cryptoCategory: "volatile" },
    { cryptoCategory: "volatile" },
  ]);
  // Daily and manual runs still capture every crypto asset once a day.
  assert.deepEqual(cryptoRefreshTargets(crypto, false), crypto);
});

test("live route returns stablecoins untouched without fetching them", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    // Bybit's order-book shape: result.b / result.a hold the bid/ask levels.
    return new Response(JSON.stringify({ result: { b: [["122", "1"]], a: [["124", "1"]] } }), { status: 200 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({
        provider: "bybit",
        assets: [
          { id: 1, symbol: "USDT", type: "crypto", cryptoCategory: "stablecoin" },
          { id: 2, symbol: "BTC", type: "crypto", cryptoCategory: "volatile" },
        ],
      }),
    }));
    const data = await response.json();
    // Only the volatile asset was quoted; the stablecoin never hit the network.
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("BTC"));
    assert.equal(data.found, 1);
    assert.equal(data.results[0].stablecoin, true);
    assert.equal(data.results[0].price, undefined);
    assert.equal(data.results[1].price, 123);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live route skips stablecoins in fallback mode too", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("unavailable", { status: 503 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({
        provider: "bybit",
        fallback: true,
        assets: [{ id: 3, symbol: "USDC", type: "crypto", cryptoCategory: "stablecoin" }],
      }),
    }));
    const data = await response.json();
    assert.equal(calls.length, 0);
    assert.equal(data.found, 0);
    assert.equal(data.results[0].stablecoin, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
