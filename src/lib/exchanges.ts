import { createHmac } from "node:crypto";
import type { ExchangeCredentials } from "@/lib/exchange-credentials";

/**
 * Read-only balance imports from Binance, OKX and Bybit.
 *
 * Only public documentation endpoints are used — no orders, no transfers, no
 * withdrawals. Signing and request building are pure functions so they can be
 * asserted in tests without a network, and the parsers accept the documented
 * response shapes loosely enough to survive the exchanges adding fields.
 */

export const EXCHANGE_IDS = ["binance", "okx", "bybit"] as const;
export type ExchangeId = (typeof EXCHANGE_IDS)[number];

export const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
};

/** Where the read-only key was created, shown next to the form. */
export const EXCHANGE_KEY_HELP: Record<ExchangeId, string> = {
  binance: "Binance → API Management → Create API → enable only “Enable Reading”. Restrict to your IP if you can.",
  okx: "OKX → Profile → API → Create V5 API key → Read Only, and note the passphrase you set.",
  bybit: "Bybit → API → Create New Key → System-generated → Read-Only permission.",
};

export const REQUEST_TIMEOUT_MS = 12_000;
/** recvWindow sent to Binance/Bybit; both reject requests older than this. */
export const RECV_WINDOW_MS = 10_000;

export type ExchangeRequest = { url: string; init: RequestInit };

export type ExchangeBalanceRow = {
  /** Uppercased ticker as the exchange reports it, e.g. "BTC". */
  symbol: string;
  /** Total units held: free + locked, or the wallet balance. */
  quantity: number;
  /** Name the exchange gave the coin, when it gives one. */
  name?: string;
};

export class ExchangeApiError extends Error {
  /** HTTP status, or 0 for a network/timeout failure. */
  readonly status: number;
  /** "auth" | "permissions" | "rate-limit" | "network" | "response" */
  readonly kind: "auth" | "permissions" | "rate-limit" | "network" | "response";

  constructor(message: string, status: number, kind: "auth" | "permissions" | "rate-limit" | "network" | "response") {
    super(message);
    this.name = "ExchangeApiError";
    this.status = status;
    this.kind = kind;
  }
}

function hmac(secret: string, payload: string, encoding: "hex" | "base64" = "hex"): string {
  return createHmac("sha256", secret).update(payload).digest(encoding);
}

/** `1234567890123` → the millisecond timestamp both Binance and Bybit want. */
export function timestampMs(now = Date.now()): string {
  return String(Math.floor(now));
}

/** OKX wants ISO-8601 with milliseconds, e.g. `2026-10-23T01:00:00.000Z`. */
export function okxTimestamp(now = Date.now()): string {
  return new Date(now).toISOString();
}

// ---------------------------------------------------------------------------
// Binance — GET /api/v3/account?timestamp=…&recvWindow=…&signature=…
// ---------------------------------------------------------------------------

/** Signed query string for Binance's account endpoint. */
export function binanceSignedQuery(secret: string, now = Date.now()): string {
  const query = `timestamp=${timestampMs(now)}&recvWindow=${RECV_WINDOW_MS}`;
  return `${query}&signature=${hmac(secret, query)}`;
}

export function binanceBalanceRequest(credentials: ExchangeCredentials, now = Date.now()): ExchangeRequest {
  return {
    url: `https://api.binance.com/api/v3/account?${binanceSignedQuery(credentials.secret, now)}`,
    init: {
      method: "GET",
      headers: { "X-MBX-APIKEY": credentials.apiKey, Accept: "application/json" },
      cache: "no-store",
    },
  };
}

/** SPOT wallet only — Earn/staking positions are not part of this endpoint. */
export function parseBinanceBalances(payload: unknown): ExchangeBalanceRow[] {
  const balances = (payload as { balances?: unknown })?.balances;
  if (!Array.isArray(balances)) return [];
  return collect(
    balances.map((row) => ({
      symbol: String((row as { asset?: unknown })?.asset ?? ""),
      quantity:
        Number((row as { free?: unknown })?.free ?? 0) + Number((row as { locked?: unknown })?.locked ?? 0),
    })),
  );
}

// ---------------------------------------------------------------------------
// OKX — GET /api/v5/account/balance
// ---------------------------------------------------------------------------

/** OKX signs `timestamp + method + requestPath + body` with the secret. */
export function okxSignature(secret: string, timestamp: string, requestPath: string, method = "GET", body = ""): string {
  return hmac(secret, `${timestamp}${method}${requestPath}${body}`, "base64");
}

export function okxBalanceRequest(credentials: ExchangeCredentials, now = Date.now()): ExchangeRequest {
  const requestPath = "/api/v5/account/balance";
  const timestamp = okxTimestamp(now);
  return {
    url: `https://www.okx.com${requestPath}`,
    init: {
      method: "GET",
      headers: {
        "OK-ACCESS-KEY": credentials.apiKey,
        "OK-ACCESS-SIGN": okxSignature(credentials.secret, timestamp, requestPath),
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": credentials.passphrase,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  };
}

/**
 * `eq` is the account equity and the closest thing to a balance; `cashBal` is
 * the fallback for accounts that report 0 equity for a coin (e.g. frozen).
 */
export function parseOkxBalances(payload: unknown): ExchangeBalanceRow[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const details = (data[0] as { details?: unknown })?.details;
  if (!Array.isArray(details)) return [];
  return collect(
    details.map((row) => {
      const record = row as Record<string, unknown>;
      const symbol = String(record.ccy ?? "");
      const eq = Number(record.eq ?? 0);
      const cash = Number(record.cashBal ?? 0);
      const available = Number(record.availBal ?? 0);
      return { symbol, quantity: eq > 0 ? eq : cash > 0 ? cash : available };
    }),
  );
}

// ---------------------------------------------------------------------------
// Bybit — GET /v5/account/wallet-balance?accountType=UNIFIED
// ---------------------------------------------------------------------------

/** Bybit signs `timestamp + apiKey + recvWindow + queryString`, hex. */
export function bybitSignature(secret: string, timestamp: string, apiKey: string, queryString: string, recvWindow = String(RECV_WINDOW_MS)): string {
  return hmac(secret, `${timestamp}${apiKey}${recvWindow}${queryString}`);
}

export function bybitBalanceRequest(credentials: ExchangeCredentials, now = Date.now()): ExchangeRequest {
  const accountType = credentials.accountType || "UNIFIED";
  const queryString = `accountType=${encodeURIComponent(accountType)}`;
  const timestamp = timestampMs(now);
  return {
    url: `https://api.bybit.com/v5/account/wallet-balance?${queryString}`,
    init: {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": credentials.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": String(RECV_WINDOW_MS),
        "X-BAPI-SIGN": bybitSignature(credentials.secret, timestamp, credentials.apiKey, queryString),
        Accept: "application/json",
      },
      cache: "no-store",
    },
  };
}

/**
 * Unified accounts report most coins in `equity` while `walletBalance` is 0, so
 * the larger of the two is used — either can be the meaningful figure depending
 * on how the account is configured.
 */
export function parseBybitBalances(payload: unknown): ExchangeBalanceRow[] {
  const list = (payload as { result?: { list?: unknown } })?.result?.list;
  if (!Array.isArray(list) || list.length === 0) return [];
  const coins = (list[0] as { coin?: unknown })?.coin;
  if (!Array.isArray(coins)) return [];
  return collect(
    coins.map((row) => {
      const record = row as Record<string, unknown>;
      const wallet = Number(record.walletBalance ?? 0);
      const equity = Number(record.equity ?? 0);
      return { symbol: String(record.coin ?? ""), quantity: Math.max(wallet, equity) };
    }),
  );
}

/** Shared cleanup: uppercase tickers, drop dust/zeros/duplicates. */
function collect(rows: Array<{ symbol: string; quantity: number }>): ExchangeBalanceRow[] {
  const bySymbol = new Map<string, number>();
  for (const row of rows) {
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol || !Number.isFinite(row.quantity) || row.quantity <= 0) continue;
    // Dust below 1e-10 is exchange noise, never something a user holds.
    if (row.quantity < 1e-10) continue;
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + row.quantity);
  }
  return [...bySymbol.entries()]
    .map(([symbol, quantity]) => ({ symbol, quantity: roundQuantity(quantity) }))
    .sort((a, b) => b.quantity - a.quantity);
}

/** Exchanges report 8 decimals at most; rounding keeps keys and echoes stable. */
export function roundQuantity(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function errorFromResponse(exchange: ExchangeId, status: number, payload: unknown): ExchangeApiError {
  const label = EXCHANGE_LABELS[exchange];
  const record = (payload ?? {}) as Record<string, unknown>;
  const code = String(record.code ?? record.retCode ?? "");
  const message = String(record.msg ?? record.message ?? "");

  if (status === 401 || status === 403) {
    return new ExchangeApiError(`${label} rejected the API key (HTTP ${status}). Check the key, secret and permissions.`, status, "auth");
  }
  if (status === 429) {
    return new ExchangeApiError(`${label} is rate-limiting requests right now — try again in a minute.`, status, "rate-limit");
  }
  // Documented "wrong permissions" codes: Binance -2015, OKX 50113, Bybit 10005/10010.
  if (["-2015", "50113", "10005", "10010"].includes(code)) {
    return new ExchangeApiError(
      `${label} says this key lacks read permission (code ${code}). Create a read-only key and try again.`,
      status,
      "permissions",
    );
  }
  const detail = message ? `: ${message}` : "";
  return new ExchangeApiError(`${label} returned an unexpected response (HTTP ${status}${code ? `, code ${code}` : ""})${detail}.`, status, "response");
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function parseBalances(exchange: ExchangeId, payload: unknown): ExchangeBalanceRow[] {
  switch (exchange) {
    case "binance":
      return parseBinanceBalances(payload);
    case "okx":
      return parseOkxBalances(payload);
    case "bybit":
      return parseBybitBalances(payload);
  }
}

/** True when the payload carries the exchange's own success marker. */
function isSuccessPayload(exchange: ExchangeId, payload: unknown): boolean {
  const record = (payload ?? {}) as Record<string, unknown>;
  if (exchange === "binance") return Array.isArray(record.balances);
  if (exchange === "okx") return String(record.code ?? "0") === "0";
  if (exchange === "bybit") return Number(record.retCode ?? 0) === 0;
  return false;
}

/** Reads every non-zero balance from one connected exchange. */
export async function fetchExchangeBalances(
  exchange: ExchangeId,
  credentials: ExchangeCredentials,
  now = Date.now(),
): Promise<ExchangeBalanceRow[]> {
  const request =
    exchange === "binance"
      ? binanceBalanceRequest(credentials, now)
      : exchange === "okx"
        ? okxBalanceRequest(credentials, now)
        : bybitBalanceRequest(credentials, now);

  let response: Response;
  try {
    response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new ExchangeApiError(
      `Could not reach ${EXCHANGE_LABELS[exchange]}. Check the server's outbound network and try again.`,
      0,
      "network",
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error page (Cloudflare, maintenance): handled below.
  }

  if (!response.ok || !isSuccessPayload(exchange, payload)) {
    throw errorFromResponse(exchange, response.status, payload);
  }

  return parseBalances(exchange, payload);
}

/**
 * Verifies a key by asking for balances. Returns the currencies found, so the
 * page can say "connected — 12 assets" instead of a bare success.
 */
export async function verifyExchangeCredentials(credentials: ExchangeCredentials): Promise<ExchangeBalanceRow[]> {
  return fetchExchangeBalances(credentials.exchange, credentials);
}
