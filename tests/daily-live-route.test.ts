import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/prices/live/route";

test("dashboard quotes fall back when the preferred exchange is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("api.exchange.coinbase.com")) {
      return new Response(JSON.stringify({ bids: [["122", "1"]], asks: [["124", "1"]] }), { status: 200 });
    }
    return new Response("unavailable", { status: 503 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({ provider: "bybit", fallback: true, assets: [{ id: 7, symbol: "BTC", type: "crypto", provider: "bybit" }] }),
    }));
    const data = await response.json();
    assert.equal(data.results[0].price, 123);
    assert.equal(data.results[0].provider, "coinbase");
    assert.ok(calls[0].includes("bybit"));
    assert.ok(calls.some((url) => url.includes("coinbase")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("existing price-page requests do not silently change the selected provider", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("unavailable", { status: 503 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({ provider: "bybit", assets: [{ id: 7, symbol: "BTC", type: "crypto" }] }),
    }));
    const data = await response.json();
    assert.equal(data.found, 0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("bybit"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
