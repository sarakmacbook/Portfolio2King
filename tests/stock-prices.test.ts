import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearFxCache,
  currencyNote,
  fetchStockQuote,
  isValidStockSymbol,
  majorCurrency,
  parseYahooChart,
  quoteToUsd,
  stockSymbolCandidates,
} from "../src/lib/stock-prices";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearFxCache();
});

/** Minimal real-world shape of `GET https://query1.finance.yahoo.com/v8/finance/chart/AAPL`. */
function chartPayload(overrides: {
  currency?: string;
  price?: number | null;
  closes?: Array<number | null>;
  symbol?: string;
} = {}) {
  const { currency = "USD", price = 262.77, closes = [261.4, 262.77], symbol = "AAPL" } = overrides;
  return {
    chart: {
      result: [
        {
          meta: {
            currency,
            symbol,
            exchangeName: "NMS",
            fullExchangeName: "NasdaqGS",
            instrumentType: "EQUITY",
            regularMarketPrice: price,
            regularMarketTime: 1_761_134_401,
          },
          timestamp: [1_761_125_400, 1_761_134_400],
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  };
}

test("stock symbols are normalised and validated", () => {
  assert.deepEqual(stockSymbolCandidates(" aapl "), ["AAPL"]);
  assert.deepEqual(stockSymbolCandidates("$AAPL"), ["AAPL"]);
  // A class share resolves on Yahoo with a dash, so that is tried as a fallback.
  assert.deepEqual(stockSymbolCandidates("BRK.B"), ["BRK.B", "BRK-B"]);
  // Tokyo listings keep their dot.
  assert.deepEqual(stockSymbolCandidates("7203.T"), ["7203.T", "7203-T"]);
  assert.deepEqual(stockSymbolCandidates("^GSPC"), ["^GSPC"]);
  assert.deepEqual(stockSymbolCandidates("BTC-USD"), ["BTC-USD"]);

  for (const invalid of ["", "   ", "AA PL", "AAPL; DROP TABLE", "a".repeat(30), "<script>"]) {
    assert.equal(isValidStockSymbol(invalid), false, `expected ${JSON.stringify(invalid)} to be invalid`);
  }
});

test("Yahoo chart payloads parse with and without a market price", () => {
  const parsed = parseYahooChart(chartPayload());
  assert.equal(parsed.price, 262.77);
  assert.equal(parsed.currency, "USD");
  assert.equal(parsed.exchange, "NasdaqGS");
  assert.equal(parsed.symbol, "AAPL");
  assert.equal(parsed.asOf?.toISOString(), new Date(1_761_134_401_000).toISOString());

  // No live price (halted / after hours): fall back to the last close.
  const fallback = parseYahooChart(chartPayload({ price: null, closes: [null, 261.4, null] }));
  assert.equal(fallback.price, 261.4);

  // A quote in another currency is reported as-is; conversion happens separately.
  assert.equal(parseYahooChart(chartPayload({ currency: "GBp", price: 78.5 })).currency, "GBp");

  // Yahoo's own error object becomes a readable message.
  assert.throws(
    () =>
      parseYahooChart({
        chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } },
      }),
    /may be delisted/,
  );
  assert.throws(() => parseYahooChart({ chart: { result: [] } }), /no price/i);
  assert.throws(() => parseYahooChart(null), /no price/i);
  assert.throws(() => parseYahooChart(chartPayload({ price: null, closes: [null, null] })), /no price/i);
});

test("quotes convert to USD, including pence and missing rates", () => {
  assert.equal(quoteToUsd(262.77, "USD", 1), 262.77);
  // GBP pence: 78.5p = £0.785, at 1.25 USD per GBP (rounded to 6 decimals).
  assert.equal(quoteToUsd(78.5, "GBp", 1.25), 0.98125);
  assert.equal(quoteToUsd(78.5, "GBX", 1.25), 0.98125);
  assert.equal(quoteToUsd(1_500_000, "ZAc", 0.055), 825);
  // A plain foreign quote multiplies by the rate.
  assert.equal(quoteToUsd(100, "EUR", 1.09), 109);

  assert.equal(majorCurrency("GBp"), "GBP");
  assert.equal(majorCurrency("ZAc"), "ZAR");
  assert.equal(majorCurrency("usd"), "USD");

  // Never store a number that is silently wrong: no rate means an error.
  assert.throws(() => quoteToUsd(100, "EUR", null), /no USD exchange rate/i);
  assert.throws(() => quoteToUsd(100, "JPY", Number.NaN), /no USD exchange rate/i);
  assert.throws(() => quoteToUsd(0, "USD", 1), /no price/i);
});

test("fetchStockQuote reads the chart endpoint and retries the dashed symbol", async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    // Yahoo does not resolve the dotted class share; the dashed form works.
    if (url.includes("/chart/BRK.B")) return new Response("not found", { status: 404 });
    if (url.includes("/chart/BRK-B")) {
      return new Response(JSON.stringify(chartPayload({ symbol: "BRK-B", price: 470.5 })), { status: 200 });
    }
    if (url.includes("/chart/EURUSD=X")) {
      return new Response(JSON.stringify(chartPayload({ symbol: "EURUSD=X", price: 1.09, currency: "USD" })), {
        status: 200,
      });
    }
    if (url.includes("/chart/AAPL")) return new Response(JSON.stringify(chartPayload()), { status: 200 });
    if (url.includes("/chart/VOD.L")) {
      return new Response(JSON.stringify(chartPayload({ symbol: "VOD.L", currency: "GBp", price: 78.5 })), {
        status: 200,
      });
    }
    if (url.includes("/chart/GBPUSD=X")) {
      return new Response(JSON.stringify(chartPayload({ symbol: "GBPUSD=X", price: 1.25, currency: "USD" })), {
        status: 200,
      });
    }
    if (url.includes("/chart/SAP.DE")) {
      return new Response(JSON.stringify(chartPayload({ symbol: "SAP.DE", currency: "EUR", price: 200 })), {
        status: 200,
      });
    }
    if (url.includes("/chart/SHOP.TO")) {
      return new Response(JSON.stringify(chartPayload({ symbol: "SHOP.TO", currency: "CAD", price: 150 })), {
        status: 200,
      });
    }
    return new Response("no data", { status: 404 });
  }) as typeof fetch;

  const aapl = await fetchStockQuote("aapl");
  assert.equal(aapl.symbol, "AAPL");
  assert.equal(aapl.price, 262.77);
  assert.equal(aapl.currency, "USD");
  assert.equal(currencyNote(aapl), "USD");

  const berkshire = await fetchStockQuote("BRK.B");
  assert.equal(berkshire.symbol, "BRK-B");
  assert.equal(berkshire.price, 470.5);

  // London: pence converted to USD through the GBP pair.
  const vodafone = await fetchStockQuote("VOD.L");
  assert.equal(vodafone.price, 0.98125);
  assert.equal(currencyNote(vodafone), "GBp → USD");

  // A euro quote is converted through the matching FX pair.
  const sap = await fetchStockQuote("SAP.DE");
  assert.equal(sap.price, 218);
  assert.equal(currencyNote(sap), "EUR → USD");

  // An unsupported currency fails loudly instead of storing a wrong number.
  await assert.rejects(() => fetchStockQuote("SHOP.TO"), /no USD exchange rate/i);

  assert.ok(seen.some((url) => url.includes("/chart/BRK-B")));
});

test("fetchStockQuote reports transport and symbol failures clearly", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 429 })) as typeof fetch;
  await assert.rejects(() => fetchStockQuote("AAPL"), /rate limit/i);

  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  await assert.rejects(() => fetchStockQuote("AAPL"), /not found/i);

  globalThis.fetch = (async () => {
    throw new Error("getaddrinfo EAI_AGAIN query1.finance.yahoo.com");
  }) as typeof fetch;
  await assert.rejects(() => fetchStockQuote("AAPL"), /unreachable|EAI_AGAIN|fetch failed/i);

  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  await assert.rejects(() => fetchStockQuote("AA PL"), /stock symbol/i);
});
