import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { GET as stocksGET } from "../src/app/api/prices/stocks/route";
import {
  POPULAR_STOCKS,
  matchCatalogStocks,
  parseYahooSearchPayload,
  searchStocks,
} from "../src/lib/stock-search";

test("POPULAR_STOCKS and matchCatalogStocks find stocks and ETFs by symbol, name, and exchange", () => {
  assert.ok(POPULAR_STOCKS.length >= 20);
  const top = matchCatalogStocks("");
  assert.equal(top.length, 12);
  assert.equal(top[0].symbol, "AAPL");

  const apple = matchCatalogStocks("apple");
  assert.ok(apple.some((s) => s.symbol === "AAPL" && s.name === "Apple Inc."));

  const vanguard = matchCatalogStocks("vanguard");
  assert.ok(vanguard.some((s) => s.symbol === "VOO" && s.kind === "ETF"));

  const toyota = matchCatalogStocks("7203.T");
  assert.equal(toyota[0]?.symbol, "7203.T");
});

test("parseYahooSearchPayload extracts equity and ETF quotes and skips non-stock entries", () => {
  const parsed = parseYahooSearchPayload({
    quotes: [
      {
        symbol: "NVDA",
        longname: "NVIDIA Corporation",
        exchDisp: "NASDAQ",
        quoteType: "EQUITY",
      },
      {
        symbol: "VOO",
        shortname: "Vanguard S&P 500 ETF",
        exchDisp: "NYSEArca",
        quoteType: "ETF",
      },
      {
        symbol: "BTC-USD",
        shortname: "Bitcoin USD",
        quoteType: "CRYPTOCURRENCY",
      },
      {
        symbol: "bad symbol",
        quoteType: "EQUITY",
      },
    ],
  });

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].symbol, "NVDA");
  assert.equal(parsed[0].kind, "Stock");
  assert.equal(parsed[1].symbol, "VOO");
  assert.equal(parsed[1].kind, "ETF");
});

test("searchStocks and /api/prices/stocks return live Yahoo matches and fall back to the stock catalog", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/finance/search")) {
        return new Response(
          JSON.stringify({
            quotes: [
              {
                symbol: "AAPL",
                longname: "Apple Inc.",
                exchDisp: "NASDAQ",
                quoteType: "EQUITY",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/v8/finance/chart/AAPL")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    symbol: "AAPL",
                    regularMarketPrice: 235.75,
                    currency: "USD",
                    fullExchangeName: "NasdaqGS",
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const liveResult = await searchStocks("Apple");
    assert.equal(liveResult.source, "yahoo");
    assert.equal(liveResult.assets[0].symbol, "AAPL");
    assert.equal(liveResult.assets[0].price, 235.75);

    const routeRes = await stocksGET(
      new Request("http://app.test/api/prices/stocks?q=Apple"),
    );
    assert.equal(routeRes.status, 200);
    const routeJson = (await routeRes.json()) as {
      assets: Array<{ symbol: string; price: number }>;
      source: string;
    };
    assert.equal(routeJson.source, "yahoo");
    assert.equal(routeJson.assets[0].symbol, "AAPL");
    assert.equal(routeJson.assets[0].price, 235.75);

    const quoteRes = await stocksGET(
      new Request("http://app.test/api/prices/stocks?symbol=AAPL"),
    );
    assert.equal(quoteRes.status, 200);
    const quoteJson = (await quoteRes.json()) as { symbol: string; price: number };
    assert.equal(quoteJson.symbol, "AAPL");
    assert.equal(quoteJson.price, 235.75);

    // When Yahoo is unreachable, scanning still returns catalog matches.
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const fallback = await searchStocks("NVDA");
    assert.equal(fallback.source, "catalog");
    assert.equal(fallback.assets[0].symbol, "NVDA");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AddAssetDialog exposes the stock asset scanner under Stock", () => {
  const dialogSource = readFileSync(
    resolve(__dirname, "../src/components/AddAssetDialog.tsx"),
    "utf8",
  );
  assert.ok(dialogSource.includes("Find any stock or ETF"));
  assert.ok(dialogSource.includes("/api/prices/stocks"));
  assert.ok(dialogSource.includes("Top stocks"));
});
