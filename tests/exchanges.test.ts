import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  ExchangeApiError,
  binanceBalanceRequest,
  binanceSignedQuery,
  bybitBalanceRequest,
  bybitSignature,
  fetchExchangeBalances,
  okxBalanceRequest,
  okxSignature,
  okxTimestamp,
  parseBinanceBalances,
  parseBybitBalances,
  parseOkxBalances,
  roundQuantity,
} from "../src/lib/exchanges";
import type { ExchangeCredentials } from "../src/lib/exchange-credentials";
import {
  decryptJson,
  encryptJson,
  looksLikeApiKey,
  looksLikeApiSecret,
  maskApiKey,
  normaliseCredential,
  parseStoredCredentials,
  ExchangeCredentialError,
} from "../src/lib/exchange-credentials";
import { describeSyncResult, type ExchangeSyncResult } from "../src/lib/exchange-sync";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");

function credentials(overrides: Partial<ExchangeCredentials> = {}): ExchangeCredentials {
  return {
    exchange: "binance",
    apiKey: "test-key-1234567890",
    secret: "test-secret-1234567890",
    passphrase: "",
    accountType: "",
    savedAt: "2026-10-23T00:00:00.000Z",
    ...overrides,
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

test("binance signature matches the documented HMAC-SHA256 vector", () => {
  // Example from Binance's SIGNED endpoint documentation (secret / query below).
  const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
  const query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
  // The published vector proves which HMAC and encoding this code must use.
  assert.equal(
    createHmac("sha256", secret).update(query).digest("hex"),
    "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71",
  );
  // The account endpoint signs timestamp+recvWindow, in that order.
  const expectedSignature = createHmac("sha256", secret).update("timestamp=1499827319559&recvWindow=10000").digest("hex");
  assert.equal(binanceSignedQuery(secret, 1_499_827_319_559), `timestamp=1499827319559&recvWindow=10000&signature=${expectedSignature}`);
  const request = binanceBalanceRequest(credentials({ secret }), 1_499_827_319_559);
  assert.match(request.url, /^https:\/\/api\.binance\.com\/api\/v3\/account\?timestamp=\d+&recvWindow=10000&signature=[0-9a-f]{64}$/);
  assert.equal((request.init.headers as Record<string, string>)["X-MBX-APIKEY"], "test-key-1234567890");
  assert.equal(request.init.method, "GET");
});

test("okx signature is base64 of timestamp+method+path", () => {
  const timestamp = "2026-10-23T01:00:00.000Z";
  assert.equal(okxSignature("okx-secret", timestamp, "/api/v5/account/balance"), "WdtgZaIpgMnbDpaTTvT1MB52RUSBe+EUvW5SFFM9I24=");
  assert.equal(okxTimestamp(Date.UTC(2026, 9, 23, 1, 0, 0)), timestamp);

  const request = okxBalanceRequest(
    credentials({ exchange: "okx", apiKey: "okx-key", secret: "okx-secret", passphrase: "pass-1" }),
    Date.UTC(2026, 9, 23, 1, 0, 0),
  );
  const headers = request.init.headers as Record<string, string>;
  assert.equal(request.url, "https://www.okx.com/api/v5/account/balance");
  assert.equal(headers["OK-ACCESS-KEY"], "okx-key");
  assert.equal(headers["OK-ACCESS-PASSPHRASE"], "pass-1");
  assert.equal(headers["OK-ACCESS-TIMESTAMP"], timestamp);
  assert.equal(headers["OK-ACCESS-SIGN"], "WdtgZaIpgMnbDpaTTvT1MB52RUSBe+EUvW5SFFM9I24=");
});

test("bybit signature is hex of timestamp+key+recvWindow+query", () => {
  assert.equal(
    bybitSignature("bybit-secret", "1700000000000", "key123", "accountType=UNIFIED"),
    "fe1d963ac9f3f7a487e0253350c889690f056680bedcac710f6a9f11e671cb92",
  );

  const request = bybitBalanceRequest(
    credentials({ exchange: "bybit", apiKey: "key123", secret: "bybit-secret" }),
    1_700_000_000_000,
  );
  const headers = request.init.headers as Record<string, string>;
  assert.equal(request.url, "https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED");
  assert.equal(headers["X-BAPI-API-KEY"], "key123");
  assert.equal(headers["X-BAPI-TIMESTAMP"], "1700000000000");
  assert.equal(headers["X-BAPI-RECV-WINDOW"], "10000");
  assert.equal(headers["X-BAPI-SIGN"], "fe1d963ac9f3f7a487e0253350c889690f056680bedcac710f6a9f11e671cb92");
});

test("bybit accepts an explicit account type", () => {
  const request = bybitBalanceRequest(credentials({ exchange: "bybit", accountType: "SPOT" }), 1_700_000_000_000);
  assert.equal(request.url, "https://api.bybit.com/v5/account/wallet-balance?accountType=SPOT");
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test("binance balances add free and locked and drop zeroes and dust", () => {
  const rows = parseBinanceBalances({
    balances: [
      { asset: "BTC", free: "0.10000000", locked: "0.05000000" },
      { asset: "ETH", free: "0.00000000", locked: "0.00000000" },
      { asset: "USDT", free: "1250.5", locked: "0" },
      { asset: "DUST", free: "0.000000000001", locked: "0" },
      { asset: "btc", free: "0.25", locked: "0" },
    ],
  });
  // Sorted by size so the biggest holding reads first.
  assert.deepEqual(rows, [
    { symbol: "USDT", quantity: 1250.5 },
    { symbol: "BTC", quantity: 0.4 },
  ]);
});

test("okx balances prefer eq, then cashBal, then available", () => {
  const rows = parseOkxBalances({
    code: "0",
    data: [
      {
        details: [
          { ccy: "BTC", eq: "0.25", cashBal: "0.24", availBal: "0.2" },
          { ccy: "ETH", eq: "0", cashBal: "1.5", availBal: "1.5" },
          { ccy: "SOL", eq: "0", cashBal: "0", availBal: "3" },
          { ccy: "DOGE", eq: "0", cashBal: "0", availBal: "0" },
        ],
      },
    ],
  });
  assert.deepEqual(rows, [
    { symbol: "SOL", quantity: 3 },
    { symbol: "ETH", quantity: 1.5 },
    { symbol: "BTC", quantity: 0.25 },
  ]);
});

test("bybit balances take the larger of wallet balance and equity", () => {
  const rows = parseBybitBalances({
    retCode: 0,
    result: {
      list: [
        {
          coin: [
            { coin: "BTC", walletBalance: "0.1", equity: "0.12" },
            { coin: "USDT", walletBalance: "500", equity: "0" },
            { coin: "ETH", walletBalance: "0", equity: "0" },
          ],
        },
      ],
    },
  });
  assert.deepEqual(rows, [
    { symbol: "USDT", quantity: 500 },
    { symbol: "BTC", quantity: 0.12 },
  ]);
});

test("parsers tolerate malformed payloads instead of throwing", () => {
  assert.deepEqual(parseBinanceBalances(null), []);
  assert.deepEqual(parseBinanceBalances({ balances: "nope" }), []);
  assert.deepEqual(parseOkxBalances({ data: [] }), []);
  assert.deepEqual(parseBybitBalances({ result: {} }), []);
  assert.equal(roundQuantity(0.123456789), 0.12345679);
});

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

test("fetchExchangeBalances reads OKX through the documented endpoint", async () => {
  const calls = stubFetch(() =>
    jsonResponse({
      code: "0",
      data: [{ details: [{ ccy: "BTC", eq: "0.5", cashBal: "0.5", availBal: "0.5" }] }],
    }),
  );
  const rows = await fetchExchangeBalances(
    "okx",
    credentials({ exchange: "okx", apiKey: "okx-key", secret: "okx-secret", passphrase: "pass" }),
  );
  assert.deepEqual(rows, [{ symbol: "BTC", quantity: 0.5 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.okx.com/api/v5/account/balance");
  assert.ok((calls[0].init?.headers as Record<string, string>)["OK-ACCESS-SIGN"]);
});

test("fetchExchangeBalances reads Bybit unified accounts", async () => {
  const calls = stubFetch(() =>
    jsonResponse({ retCode: 0, result: { list: [{ coin: [{ coin: "BTC", walletBalance: "0.2", equity: "0.2" }] }] } }),
  );
  const rows = await fetchExchangeBalances("bybit", credentials({ exchange: "bybit", apiKey: "bybit-key", secret: "bybit-secret" }));
  assert.deepEqual(rows, [{ symbol: "BTC", quantity: 0.2 }]);
  assert.match(calls[0].url, /accountType=UNIFIED/);
});

test("fetchExchangeBalances reads Binance spot balances", async () => {
  stubFetch(() => jsonResponse({ balances: [{ asset: "BTC", free: "1", locked: "0" }] }));
  const rows = await fetchExchangeBalances("binance", credentials());
  assert.deepEqual(rows, [{ symbol: "BTC", quantity: 1 }]);
});

test("a rejected key becomes a readable error, not a crash", async () => {
  stubFetch(() => jsonResponse({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }, 400));
  await assert.rejects(
    () => fetchExchangeBalances("binance", credentials()),
    (error: unknown) =>
      error instanceof ExchangeApiError &&
      error.kind === "permissions" &&
      /read permission/.test(error.message) &&
      !error.message.includes(credentials().secret),
  );

  stubFetch(() => jsonResponse({ message: "Unauthorized" }, 401));
  await assert.rejects(
    () => fetchExchangeBalances("okx", credentials({ exchange: "okx" })),
    (error: unknown) => error instanceof ExchangeApiError && error.kind === "auth",
  );

  stubFetch(() => jsonResponse({}, 429));
  await assert.rejects(
    () => fetchExchangeBalances("bybit", credentials({ exchange: "bybit" })),
    (error: unknown) => error instanceof ExchangeApiError && error.kind === "rate-limit",
  );
});

test("a network failure is reported as such", async () => {
  stubFetch(() => Promise.reject(new Error("ECONNREFUSED 1.2.3.4")));
  await assert.rejects(
    () => fetchExchangeBalances("binance", credentials()),
    (error: unknown) =>
      error instanceof ExchangeApiError &&
      error.kind === "network" &&
      /Could not reach Binance/.test(error.message) &&
      !/ECONNREFUSED/.test(error.message),
  );
});

test("a success status with an error body is still an error", async () => {
  stubFetch(() => jsonResponse({ code: "50113", msg: "Invalid API Key" }, 200));
  await assert.rejects(
    () => fetchExchangeBalances("okx", credentials({ exchange: "okx" })),
    (error: unknown) => error instanceof ExchangeApiError && /read permission/.test(error.message),
  );
});

// ---------------------------------------------------------------------------
// Credential handling
// ---------------------------------------------------------------------------

test("credentials round-trip through AES-256-GCM", () => {
  const value = { apiKey: "abc", secret: "shh", passphrase: "p" };
  const blob = encryptJson(value, KEY);
  assert.match(blob, /^v1\./);
  assert.ok(!blob.includes("shh"), "ciphertext must not contain the secret");
  assert.deepEqual(decryptJson(blob, KEY), value);
});

test("tampering or a wrong key is detected, never silently decrypted", () => {
  const blob = encryptJson({ apiKey: "abc", secret: "shh" }, KEY);
  const other = Buffer.from("ffffffffffffffffffffffffffffffff", "utf8");
  assert.throws(() => decryptJson(blob, other), (error: unknown) => error instanceof ExchangeCredentialError);
  assert.throws(() => decryptJson("v1.bad", KEY), (error: unknown) => error instanceof ExchangeCredentialError);
  const parts = blob.split(".");
  parts[3] = `${parts[3].slice(0, -2)}AA`;
  assert.throws(() => decryptJson(parts.join("."), KEY), (error: unknown) => error instanceof ExchangeCredentialError);
});

test("the browser only ever sees a masked key", () => {
  assert.equal(maskApiKey("abcdef1234567890"), "••••••••7890");
  assert.equal(maskApiKey("abc"), "••••");
  assert.ok(!maskApiKey("abcdef1234567890").includes("abcdef"));
});

test("credential input is trimmed, bounded and shape-checked", () => {
  assert.equal(normaliseCredential("  abc  ", "API key"), "abc");
  assert.throws(() => normaliseCredential("x".repeat(257), "API key"), /longer than 256/);
  assert.ok(looksLikeApiKey("3f9a1c2d-4b5e-6f70-8192-a3b4c5d6e7f8"));
  assert.ok(!looksLikeApiKey("not a key"));
  assert.ok(!looksLikeApiKey("short"));
  assert.ok(looksLikeApiSecret("bG9uZytzZWNyZXQvZXhhbXBsZQ=="));
  assert.ok(!looksLikeApiSecret("has space in it"));
});

test("stored rows are re-validated on read", () => {
  const parsed = parseStoredCredentials("okx", {
    apiKey: "k",
    secret: "s",
    passphrase: "p",
    accountType: "",
    savedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(parsed?.exchange, "okx");
  assert.equal(parsed?.passphrase, "p");
  assert.equal(parseStoredCredentials("okx", { apiKey: "k" }), null);
  assert.equal(parseStoredCredentials("okx", null), null);
});

// ---------------------------------------------------------------------------
// Result narration
// ---------------------------------------------------------------------------

test("sync results read like a sentence", () => {
  const base: ExchangeSyncResult = {
    exchange: "binance",
    label: "Binance",
    syncedAt: "2026-10-23T00:00:00.000Z",
    reported: 2,
    changes: [],
    closed: [],
    warnings: [],
  };
  assert.equal(describeSyncResult(base), "Binance: already up to date (2 assets).");
  assert.equal(
    describeSyncResult({
      ...base,
      changes: [
        { symbol: "BTC", delta: 0.5, kind: "deposit", created: true },
        { symbol: "ETH", delta: 0.25, kind: "deposit", created: false },
      ],
    }),
    "Binance: added BTC, updated 1 holding.",
  );
  assert.equal(describeSyncResult({ ...base, reported: 0 }), "Binance: no balances found.");
  assert.equal(describeSyncResult({ ...base, closed: ["DOGE"] }), "Binance: removed DOGE.");
});
