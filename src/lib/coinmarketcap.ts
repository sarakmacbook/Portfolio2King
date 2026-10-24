/**
 * CoinMarketCap contract matching.
 *
 * The scan returns whatever contracts a wallet holds, and the only thing that
 * separates the real `USDC` from a clone is the address. A hand-kept table
 * (`token-trust`) knows the big issuers; it cannot know the long tail. CoinMarketCap
 * can: `GET /v2/cryptocurrency/info?address=…` answers with the coin that address
 * belongs to — its id, name, slug and symbol — for every token it lists.
 *
 * So this module answers three questions about the contracts a scan just found:
 *
 *   - is this address listed on CoinMarketCap at all, and as which coin?
 *   - does the scanned symbol agree with the listed one? (If it does not, the
 *     contract belongs to a *different* coin than the ticker claims — reported,
 *     never hidden: `RNDR` → `RENDER` and `USDC.e` → `USDC` are honest renames.)
 *   - what is that coin's USD price? (Fills the "no price yet" case with a real
 *     market price instead of leaving the token unpriced.)
 *
 * The key is optional: without `CMC_PRO_API_KEY` nothing is asked, every status
 * stays `unknown`, and the scan behaves exactly as before. Unknown is never a
 * reason to hide a holding.
 *
 * Parsers are pure, so they are testable without a network — see
 * tests/coinmarketcap.test.ts.
 */

import type { ContractStatus } from "@/lib/token-trust";

export const CMC_API_BASE = "https://pro-api.coinmarketcap.com";

/**
 * Addresses per `info` call. CMC accepts a comma-separated list; 50 keeps the URL
 * short and a whole scan to a handful of credits.
 */
export const CMC_BATCH_SIZE = 50;

/** The most contracts one scan will ask about (the tail is dust anyway). */
export const MAX_CMC_ADDRESSES = 150;

export const CMC_TIMEOUT_MS = 8_000;

/** How long the whole CMC pass may take before the rest is skipped. */
export const CMC_TOTAL_BUDGET_MS = 8_000;

/** CoinMarketCap's key, under either of the names this app accepts. */
export function cmcApiKey(env: Record<string, string | undefined> = process.env): string {
  return (env.CMC_PRO_API_KEY ?? env.COINMARKETCAP_API_KEY ?? "").trim();
}

export const CMC_NEEDS_KEY_MESSAGE =
  "CoinMarketCap matching needs a CMC_PRO_API_KEY (a free Basic key covers contract lookups); without one the contracts stay unverified.";

/** One contract as CoinMarketCap lists it. */
export type CmcToken = {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  /** The address CMC has for this coin, lower-cased, when it has one. */
  contractAddress: string | null;
  logo?: string;
};

/** What CMC said about one scanned contract. */
export type CmcMatch = {
  /** `official` when the address is listed and the ticker agrees. */
  status: ContractStatus;
  token?: CmcToken;
  /**
   * The address is listed, but under a different ticker than the scan showed.
   * Reported as a note; never used to hide, because symbol renames are common.
   */
  symbolMismatch?: boolean;
  /** The listed URL for the coin, when CMC sent one. */
  url?: string;
};

function text(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

function numberOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** CMC error text, if the answer is an error rather than data. */
export function cmcErrorText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const status = record.status;
  if (!status || typeof status !== "object") {
    const message = text(record.message ?? record.error);
    return message;
  }
  const statusRecord = status as Record<string, unknown>;
  const errorCode = numberOf(statusRecord.error_code);
  const message = text(statusRecord.error_message);
  if (errorCode === 0) return "";
  return message || `CoinMarketCap error ${errorCode}`;
}

/** The `data` object of an answer, or an empty record. */
function dataRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return {};
  return data as Record<string, unknown>;
}

/** `address` list → the `info` URL. */
export function cmcInfoUrl(addresses: readonly string[]): string {
  const list = addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
  return `${CMC_API_BASE}/v2/cryptocurrency/info?address=${encodeURIComponent(list.join(","))}&skip_invalid=true`;
}

/** Coin ids → the `quotes/latest` URL. */
export function cmcQuotesUrl(ids: readonly number[]): string {
  return `${CMC_API_BASE}/v1/cryptocurrency/quotes/latest?id=${ids.join(",")}&skip_invalid=true`;
}

function toCmcToken(raw: unknown): CmcToken | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const symbol = text(record.symbol).trim().toUpperCase();
  const id = numberOf(record.id);
  if (!symbol || id <= 0) return null;
  const contract = text(record.contract_address).trim().toLowerCase();
  return {
    id,
    name: text(record.name).trim() || symbol,
    symbol,
    slug: text(record.slug).trim(),
    contractAddress: /^0x[0-9a-f]{40}$/.test(contract) ? contract : null,
    ...(text(record.logo) ? { logo: text(record.logo) } : {}),
  };
}

/**
 * Shapes a `cryptocurrency/info` answer into a map keyed by lower-case contract.
 *
 * CMC keys `data` by whatever was asked (the address) and may send the value as
 * an object or an array of coins; both shapes are handled, and the entry whose
 * own `contract_address` matches the requested address wins over the first one.
 */
export function parseCmcInfo(payload: unknown): Map<string, CmcToken> {
  const found = new Map<string, CmcToken>();
  const data = dataRecord(payload);

  for (const [key, value] of Object.entries(data)) {
    const wanted = key.trim().toLowerCase();
    const rows = Array.isArray(value) ? value : [value];
    const tokens = rows.map(toCmcToken).filter((token): token is CmcToken => token !== null);
    if (tokens.length === 0) continue;
    const exact = tokens.find((token) => token.contractAddress && token.contractAddress === wanted);
    const chosen = exact ?? tokens[0];
    if (!found.has(wanted)) found.set(wanted, chosen);
  }

  return found;
}

/** Shapes a `quotes/latest` answer into `id → USD price`. */
export function parseCmcQuotes(payload: unknown): Map<number, number> {
  const prices = new Map<number, number>();
  const data = dataRecord(payload);

  const readOne = (raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    const id = numberOf(record.id);
    const quote = record.quote;
    if (id <= 0 || !quote || typeof quote !== "object") return;
    const usd = (quote as Record<string, unknown>).USD;
    if (!usd || typeof usd !== "object") return;
    const price = numberOf((usd as Record<string, unknown>).price);
    if (price > 0) prices.set(id, price);
  };

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) value.forEach(readOne);
    else readOne(value);
  }

  return prices;
}

/**
 * Two tickers that mean the same coin.
 *
 * Punctuation and case are ignored (`USDC.E` = `USDC.e` = `USDC`), and a suffix
 * variant counts as the same coin because bridges and wrappers produce them.
 */
export function sameTicker(a: string, b: string): boolean {
  const clean = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // `USDC` / `USDC.E`, `STETH` / `WSTETH`: one ticker carries the other, with a
  // bridge or wrapper marker around it. Three letters minimum, so `SOL` and `LA`
  // style noise cannot match by accident.
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 3 && longer.includes(shorter);
}

/**
 * What CoinMarketCap says about one scanned balance.
 *
 * `official` needs both halves: the address is listed, and the ticker on the
 * listing agrees with the ticker the scan showed. A listed address under a
 * different ticker is a *mismatch* — reported, never turned into "hide me",
 * because `RNDR`→`RENDER` and bridged `USDC.e` are legitimate.
 */
export function cmcMatchFor(
  balance: { symbol?: string | null; contract?: string | null },
  info: ReadonlyMap<string, CmcToken>,
): CmcMatch | null {
  const contract = typeof balance.contract === "string" ? balance.contract.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{40}$/.test(contract)) return null;
  const token = info.get(contract);
  if (!token) return null;

  const symbol = typeof balance.symbol === "string" ? balance.symbol : "";
  if (!symbol.trim()) return { status: "unknown", token };
  if (sameTicker(symbol, token.symbol)) return { status: "official", token };
  return { status: "unknown", token, symbolMismatch: true };
}

/**
 * Combines the local official-contract table with CoinMarketCap's answer.
 *
 * Precedence, and why:
 *
 * 1. the local table saying **different** wins — the app knows the real address
 *    for that ticker on that chain, so a mismatch is a look-alike;
 * 2. either source saying **official** makes it official;
 * 3. otherwise **unknown** — CMC not listing a token says nothing about whether
 *    it is real.
 */
export function mergeContractStatus(local: ContractStatus, cmc: CmcMatch | null): ContractStatus {
  if (local === "different") return "different";
  if (local === "official") return "official";
  if (cmc?.status === "official") return "official";
  return "unknown";
}

export type CmcLookup = {
  ok: boolean;
  info: Map<string, CmcToken>;
  prices: Map<number, number>;
  error?: string;
  needsKey?: boolean;
  /** How many contracts were asked about. */
  looked: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function getJson(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": apiKey,
      },
      cache: "no-store",
    });
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks up every contract and, for the coins it recognised, their USD price.
 *
 * Batched (50 addresses per call) and best-effort: a failure returns what did
 * arrive, so a rate limit can never hide or invent a token. `quotes` costs one
 * more call and is optional (`prices: false` skips it).
 */
export async function fetchCmcContracts(
  addresses: readonly string[],
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    budgetMs?: number;
    batchSize?: number;
    maxAddresses?: number;
    prices?: boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<CmcLookup> {
  const unique = [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
    ),
  ].slice(0, options.maxAddresses ?? MAX_CMC_ADDRESSES);

  const apiKey = (options.apiKey ?? cmcApiKey()).trim();
  if (!apiKey) {
    return { ok: false, info: new Map(), prices: new Map(), needsKey: true, looked: 0, error: CMC_NEEDS_KEY_MESSAGE };
  }
  if (unique.length === 0) {
    return { ok: true, info: new Map(), prices: new Map(), looked: 0 };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CMC_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? CMC_TOTAL_BUDGET_MS;
  const batchSize = Math.max(1, options.batchSize ?? CMC_BATCH_SIZE);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const started = now();

  const info = new Map<string, CmcToken>();
  let firstError = "";
  let needsKey = false;
  let answered = false;

  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += batchSize) {
    batches.push(unique.slice(index, index + batchSize));
  }

  for (const batch of batches) {
    if (now() - started >= budgetMs) break;
    const payload = await getJson(cmcInfoUrl(batch), apiKey, fetchImpl, timeoutMs);
    // No answer at all (timeout, DNS, offline): not "this coin is not listed".
    if (payload === null || payload === undefined) {
      if (!firstError) firstError = "CoinMarketCap did not answer.";
      continue;
    }
    const error = cmcErrorText(payload);
    if (error) {
      const lower = error.toLowerCase();
      if (/api key|unauthoriz|invalid key|authentication/.test(lower)) needsKey = true;
      if (!firstError) firstError = error;
      continue;
    }
    answered = true;
    for (const [address, token] of parseCmcInfo(payload)) info.set(address, token);
  }

  const prices = new Map<number, number>();
  if (options.prices !== false && info.size > 0 && now() - started < budgetMs) {
    const ids = [...new Set([...info.values()].map((token) => token.id))];
    if (ids.length > 0) {
      const payload = await getJson(cmcQuotesUrl(ids), apiKey, fetchImpl, timeoutMs);
      if (!cmcErrorText(payload)) {
        for (const [id, price] of parseCmcQuotes(payload)) prices.set(id, price);
      }
    }
  }

  if (!answered && info.size === 0) {
    return {
      ok: false,
      info,
      prices,
      looked: unique.length,
      ...(needsKey ? { needsKey: true } : {}),
      error: firstError || "CoinMarketCap did not answer.",
    };
  }

  return { ok: true, info, prices, looked: unique.length, ...(firstError ? { error: firstError } : {}) };
}
