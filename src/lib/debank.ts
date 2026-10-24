/**
 * DeBank balance detection.
 *
 * DeBank indexes every EVM chain — 100+ of them — and returns the tokens a
 * wallet holds with their USD price, which is exactly what "Add via wallet
 * address" needs: one call instead of an RPC round-trip per chain and a price
 * lookup per ticker.
 *
 * Nothing here is limited to a fixed chain list: whatever chain id DeBank
 * returns is kept, labelled from `DEBANK_CHAIN_LABELS` or — for a chain this app
 * has never seen — from DeBank's own `/v1/chain/list`, so a wallet on a brand
 * new rollup still shows up. Only the *fallback* on-chain reader has a fixed
 * chain list, because that one needs an RPC URL per chain.
 *
 * Two APIs are supported:
 *
 * - the **Open API** (`pro-openapi.debank.com/v1/...`) when `DEBANK_ACCESS_KEY`
 *   is set — the supported, documented route (a free key from
 *   <https://cloud.debank.com> is enough);
 * - the **public endpoints** otherwise, tried in order: DeBank's own API gateway
 *   (`api.debank.com/v1/user/token_list`, the same paths the Open API exposes),
 *   its legacy web route (`api.debank.com/token/balance_list`, which takes
 *   `user_id` — `user_addr` answers 404), and finally Rabby's public API
 *   (`api.rabby.io`, DeBank's wallet, same response shape). Any of them can be
 *   rate-limited or blocked, which is why every failure here is swallowed: the
 *   scanner then falls back to reading balances straight from public RPCs.
 *
 * Everything that shapes a response into balances is a pure function so it can
 * be tested without a network — see tests/debank.test.ts.
 */
import type { CryptoCategory } from "@/db/schema";
import { isStablecoinSymbol } from "@/lib/stablecoins";
import {
  canonicalChainId,
  chainMatchesFilter,
  debankChainLabel,
  hasKnownChainLabel,
  type WalletChain,
} from "@/lib/wallet-chains";

export const DEBANK_TIMEOUT_MS = 6000;

/**
 * How long one scan may spend on DeBank overall. Three keyless routes at six
 * seconds each would make the wallet dialog crawl when they are all blocked, so
 * the remaining routes are skipped once the budget is gone (the on-chain read
 * then takes over).
 */
export const DEBANK_TOTAL_BUDGET_MS = 12000;

/**
 * How many tokens one scan may return (protects the picker from spam airdrops).
 * Generous, because a wallet spread over 100+ chains can legitimately hold a lot
 * — the list is sorted by USD value, so the tail that gets cut is the dust.
 */
export const MAX_DEBANK_TOKENS = 250;

/**
 * A chain as DeBank names it. Known chains keep the app's own id (`ethereum`,
 * `arbitrum`, …) so the rest of the app reads naturally; every other DeBank
 * chain keeps its DeBank id (`sonic`, `zora`, …).
 */
type ScannedChain = string;

/**
 * DeBank chain id → the chain vocabulary used by the app, for the chains the
 * direct on-chain reader also covers. Ids outside this map are not rejected:
 * they are returned as their canonical DeBank id (see `walletChainFromDebankId`).
 */
export const DEBANK_CHAIN_IDS: Record<string, ScannedChain> = {
  eth: "ethereum",
  ethereum: "ethereum",
  bsc: "bsc",
  bnb: "bsc",
  arb: "arbitrum",
  arbitrum: "arbitrum",
  base: "base",
  matic: "polygon",
  polygon: "polygon",
  op: "optimism",
  optimism: "optimism",
  avax: "avalanche",
  avalanche: "avalanche",
  era: "zksync",
  zksync: "zksync",
  zkscroll: "zksync",
  linea: "linea",
  scr: "scroll",
  scrl: "scroll",
  scroll: "scroll",
  mnt: "mantle",
  mantle: "mantle",
  blast: "blast",
  ftm: "fantom",
  fantom: "fantom",
  gno: "gnosis",
  gnosis: "gnosis",
  xdai: "gnosis",
  cro: "cronos",
  cronos: "cronos",
};

/** The id DeBank expects when a request is limited to one chain. */
const WALLET_CHAIN_TO_DEBANK: Record<ScannedChain, string> = {
  ethereum: "eth",
  bsc: "bsc",
  arbitrum: "arb",
  base: "base",
  polygon: "matic",
  optimism: "op",
  avalanche: "avax",
  zksync: "era",
  linea: "linea",
  scroll: "scr",
  mantle: "mnt",
  blast: "blast",
  fantom: "ftm",
  gnosis: "gno",
  cronos: "cro",
  solana: "solana",
  bitcoin: "bitcoin",
  tron: "tron",
};

export type DebankBalance = {
  id: string;
  symbol: string;
  name: string;
  chain: ScannedChain;
  chainLabel: string;
  quantity: number;
  price: number;
  valueUsd: number;
  category: CryptoCategory;
  contract: string | null;
  logoUrl: string;
};

export type DebankRequest = { url: string; headers: Record<string, string> };

/**
 * The DeBank chain id to send for a chain filter, or `null` when no chain should
 * be sent (every chain, or a non-EVM chain DeBank does not index).
 *
 * Accepts any chain id — the app's own (`ethereum`) or DeBank's (`eth`), and
 * chains beyond the built-in list, because DeBank serves far more of them.
 */
export function debankChainIdFor(chain: string): string | null {
  if (!chain || chain === "auto") return null;
  const key = canonicalChainId(chain);
  if (!key || key === "solana" || key === "bitcoin" || key === "tron") return null;
  return WALLET_CHAIN_TO_DEBANK[key as ScannedChain] ?? key;
}

/**
 * The chain for a DeBank chain id.
 *
 * Accepts both vocabularies (`eth` and `ethereum`, `arb` and `arbitrum`) and —
 * importantly — does **not** reject the ids it does not recognise: DeBank adds
 * chains constantly, so an unknown id is returned as its canonical DeBank id
 * instead of dropping the token from the scan. `null` is only returned when the
 * payload has no usable chain at all.
 */
export function walletChainFromDebankId(id: unknown): ScannedChain | null {
  if (typeof id !== "string") return null;
  const key = canonicalChainId(id);
  if (!key) return null;
  return DEBANK_CHAIN_IDS[key] ?? key;
}

function readNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isEvmContract(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

/** Pulls the token array out of the shapes the two DeBank APIs return. */
export function debankTokenItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  // A non-zero error_code means the body is an error, not a token list.
  if (readNumber(record.error_code) !== 0 || readNumber(record.errorCode) !== 0) return [];
  for (const key of ["data", "tokens", "list", "result"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      for (const innerKey of ["tokens", "list", "token_list"]) {
        if (Array.isArray(nested[innerKey])) return nested[innerKey] as unknown[];
      }
    }
  }
  return [];
}

/**
 * The explanation DeBank puts *inside* a 200 response.
 *
 * Its APIs answer `200 OK` with `{ "error_code": 1, "error_message": "…" }` (or
 * `{ "error": { "code", "message" } }`, `{ "code": 401, "msg": … }` …) when a
 * request is refused, which is easy to mistake for "this wallet is empty". That
 * mistake used to be reported as "DeBank returned no tokens for that wallet".
 */
export function debankErrorText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;

  const direct = readString(record.error_message) || readString(record.errorMessage);
  let text =
    direct || readString(record.msg) || readString(record.message) || readString(record.detail);
  let nestedCode = 0;
  if (!text) {
    const error = record.error;
    if (typeof error === "string") text = error.trim();
    else if (error && typeof error === "object") {
      const nested = error as Record<string, unknown>;
      text = readString(nested.message) || readString(nested.msg) || readString(nested.error);
      nestedCode = readNumber(nested.code) || readNumber(nested.status);
    }
  }

  const code =
    readNumber(record.error_code) ||
    readNumber(record.errorCode) ||
    readNumber(record.status) ||
    readNumber(record.code) ||
    nestedCode;
  const failed = record.success === false || (code !== 0 && code !== 200);
  if (!failed && !text) return "";
  if (text) return code && code !== 200 ? `${text} (code ${code})` : text;
  return `DeBank returned error code ${code}`;
}

/** What a 200 response from DeBank actually says. */
export type DebankAnswer =
  /** DeBank listed tokens (possibly all dust — `parseDebankTokens` decides). */
  | { kind: "tokens"; items: unknown[] }
  /** DeBank answered with an empty list: the wallet really holds nothing there. */
  | { kind: "empty" }
  /** DeBank answered with an error body — a refusal, not an empty wallet. */
  | { kind: "error"; message: string }
  /** A 200 this app cannot interpret (an HTML challenge page, `{}`, …). */
  | { kind: "unreadable"; message: string };

/** True when the payload carries an empty list under any of DeBank's keys. */
function hasEmptyList(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.length === 0;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "tokens", "list", "result"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.length === 0;
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      for (const innerKey of ["tokens", "list", "token_list", "items"]) {
        if (Array.isArray(nested[innerKey])) return (nested[innerKey] as unknown[]).length === 0;
      }
    }
  }
  return false;
}

/**
 * Classifies a DeBank response so the caller can tell three very different
 * things apart: "here are the tokens", "this wallet is empty" and "we were
 * refused". Only the middle one is the wallet's fault.
 */
export function readDebankAnswer(payload: unknown): DebankAnswer {
  const errorText = debankErrorText(payload);
  if (errorText) return { kind: "error", message: errorText };

  const items = debankTokenItems(payload);
  if (items.length > 0) return { kind: "tokens", items };
  if (hasEmptyList(payload)) return { kind: "empty" };

  return {
    kind: "unreadable",
    message: "DeBank sent an answer that could not be read (it may now require an access key).",
  };
}

/**
 * Shapes a DeBank token list into balances: drops empty, worthless spam (unless
 * DeBank marks it core/verified), de-duplicates the same token seen twice and
 * sorts by USD value.
 *
 * Every chain DeBank returns is kept — the chain is never a reason to drop a
 * token, because DeBank indexes far more EVM chains than this app lists by hand.
 */
export function parseDebankTokens(
  payload: unknown,
  options: { chainFilter?: string; maxItems?: number } = {},
): DebankBalance[] {
  const chainFilter =
    options.chainFilter && options.chainFilter !== "auto" ? options.chainFilter : null;
  const nonEvm = new Set(["solana", "bitcoin", "tron"]);
  const maxItems = Math.max(1, Math.min(MAX_DEBANK_TOKENS, options.maxItems ?? MAX_DEBANK_TOKENS));
  const seen = new Set<string>();
  const balances: DebankBalance[] = [];

  for (const raw of debankTokenItems(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const symbol = readString(item.symbol) || readString(item.token_symbol);
    if (!symbol) continue;

    const chain =
      walletChainFromDebankId(item.chain) ??
      walletChainFromDebankId(item.chain_id) ??
      walletChainFromDebankId(item.chainId) ??
      (chainFilter && chainFilter !== "solana" && chainFilter !== "bitcoin" && chainFilter !== "tron"
        ? chainFilter
        : null);
    if (!chain) continue;
    // The filter is alias-aware, so "ethereum" matches DeBank's `eth`.
    if (chainFilter && !chainMatchesFilter(chain, chainFilter)) continue;
    // DeBank only indexes the EVM side; non-EVM chains cannot appear here.
    if (nonEvm.has(canonicalChainId(chain))) continue;

    const contractRaw =
      readString(item.id) || readString(item.contract) || readString(item.token_address);
    const contract = isEvmContract(contractRaw) ? contractRaw : null;

    const decimals = Math.max(0, Math.min(36, Math.round(readNumber(item.decimals) || 18)));
    let quantity = readNumber(item.amount) || readNumber(item.balance);
    if (quantity <= 0 && readNumber(item.raw_amount) > 0) {
      quantity = readNumber(item.raw_amount) / 10 ** decimals;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const price = readNumber(item.price) || readNumber(item.price_usd);
    // The Open API spells it `usd_value`, the web gateway `value_usd`; the last
    // resort is quantity × price.
    const valueUsd =
      readNumber(item.value_usd) || readNumber(item.usd_value) || quantity * price;
    const isCore = item.is_core === true || item.is_verified === true || item.is_scam === false;
    // Airdropped junk: no price, not recognised by DeBank, no value.
    if (price <= 0 && valueUsd <= 0 && !isCore) continue;

    const key = `${chain}:${contract ?? symbol.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    balances.push({
      id: `debank:${chain}:${contract ?? symbol.toUpperCase()}`,
      symbol: symbol.toUpperCase(),
      name: readString(item.name) || symbol.toUpperCase(),
      chain,
      chainLabel: debankChainLabel(chain),
      quantity: Number(quantity.toFixed(8)),
      price,
      valueUsd: Number(valueUsd.toFixed(2)),
      category: isStablecoinSymbol(symbol) ? "stablecoin" : "volatile",
      contract,
      logoUrl: readString(item.logo_url) || readString(item.logoUrl),
    });
  }

  return balances
    .sort((a, b) => b.valueUsd - a.valueUsd || b.quantity - a.quantity)
    .slice(0, maxItems);
}

/** The browser-ish headers the keyless endpoints expect (they sit behind a CDN). */
const PUBLIC_HEADERS: Record<string, string> = {
  Accept: "application/json",
  Origin: "https://debank.com",
  Referer: "https://debank.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};

/** Rabby's public API is the same data behind DeBank's own wallet. */
const RABBY_HEADERS: Record<string, string> = {
  Accept: "application/json",
  Origin: "https://rabby.io",
  Referer: "https://rabby.io/",
  // Rabby's gateway is versioned by header; it ignores unknown extra headers,
  // so sending this costs nothing when it is not needed.
  "X-API-Version": "v1",
  "User-Agent": PUBLIC_HEADERS["User-Agent"],
};

/**
 * The endpoints to try, best first.
 *
 * With an access key the supported Open API route is used on its own: a keyed
 * failure is a configuration problem (bad or expired key), not something a
 * keyless endpoint should paper over. Without one, three public routes are tried
 * — DeBank's API gateway, its legacy web route and Rabby's API — because DeBank
 * retires and renames keyless endpoints without notice, and a 404 from a stale
 * one should not end the scan.
 */
export function debankRequests(
  address: string,
  chain: string = "auto",
  accessKey = process.env.DEBANK_ACCESS_KEY ?? "",
): DebankRequest[] {
  const addr = encodeURIComponent(address.trim());
  const key = accessKey.trim();
  const chainId = debankChainIdFor(chain);
  const json = { Accept: "application/json" };

  if (key) {
    // `/all_token_list` still answers for every chain; `/token_list` needs one.
    const url = chainId
      ? `https://pro-openapi.debank.com/v1/user/token_list?id=${addr}&chain_id=${chainId}&is_all=false`
      : `https://pro-openapi.debank.com/v1/user/all_token_list?id=${addr}&is_all=false`;
    return [{ url, headers: { ...json, AccessKey: key } }];
  }

  const chainQuery = chainId ? `&chain_id=${chainId}` : "";
  return [
    // The gateway path the Open API documents, served without a key.
    {
      url: `https://api.debank.com/v1/user/token_list?id=${addr}${chainQuery}&is_all=false`,
      headers: PUBLIC_HEADERS,
    },
    // The legacy web route still used by debank.com itself. It is keyed on
    // `user_id`; `user_addr` (the old name) now answers 404.
    {
      url: `https://api.debank.com/token/balance_list?user_id=${addr}&is_all=false${
        chainId ? `&chain=${chainId}` : ""
      }`,
      headers: PUBLIC_HEADERS,
    },
    // DeBank's wallet, Rabby, reads from the same indexer.
    {
      url: `https://api.rabby.io/v1/user/token_list?id=${addr}${chainQuery}&is_all=false`,
      headers: RABBY_HEADERS,
    },
  ];
}

/**
 * The same request, but asking DeBank for *every* token it knows about
 * (`is_all=true`) instead of the filtered core set.
 *
 * The scans above use `is_all=false`, which is what keeps a wallet readable —
 * but a wallet holding only non-core tokens answers that with an empty list. If
 * every route says "empty", one last call asks for everything before the app
 * concludes the wallet really holds nothing.
 */
export function debankAllTokensRequest(
  address: string,
  chain: WalletChain | string = "auto",
  accessKey = process.env.DEBANK_ACCESS_KEY ?? "",
): DebankRequest {
  const addr = encodeURIComponent(address.trim());
  const key = accessKey.trim();
  const chainId = debankChainIdFor(chain);
  if (key) {
    const url = chainId
      ? `https://pro-openapi.debank.com/v1/user/token_list?id=${addr}&chain_id=${chainId}&is_all=true`
      : `https://pro-openapi.debank.com/v1/user/all_token_list?id=${addr}&is_all=true`;
    return { url, headers: { Accept: "application/json", AccessKey: key } };
  }
  return {
    url: `https://api.debank.com/v1/user/token_list?id=${addr}${
      chainId ? `&chain_id=${chainId}` : ""
    }&is_all=true`,
    headers: PUBLIC_HEADERS,
  };
}

/**
 * How long DeBank's chain list is cached. New chains appear on DeBank's side
 * every few weeks, so a long-lived server only needs to ask occasionally.
 */
export const DEBANK_CHAIN_LIST_TTL_MS = 6 * 60 * 60 * 1000;

let chainNameCache: { names: Map<string, string>; at: number } | null = null;

/** The requests that ask DeBank for every chain it supports. */
export function debankChainListRequests(
  accessKey = process.env.DEBANK_ACCESS_KEY ?? "",
): DebankRequest[] {
  const key = accessKey.trim();
  if (key) {
    return [
      {
        url: "https://pro-openapi.debank.com/v1/chain/list",
        headers: { Accept: "application/json", AccessKey: key },
      },
    ];
  }
  return [
    { url: "https://api.debank.com/v1/chain/list", headers: PUBLIC_HEADERS },
    { url: "https://api.rabby.io/v1/chain/list", headers: RABBY_HEADERS },
  ];
}

/** `[{ id, name, … }]` → `id → name`, ignoring anything malformed. */
export function parseDebankChainList(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as unknown[])
      : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = readString(item.id).toLowerCase();
    const name = readString(item.name);
    if (!id || !name) continue;
    names.set(id, name);
  }
  return names;
}

/**
 * The chain names DeBank reports, cached for a while. Best effort: a failure
 * leaves unknown chains labelled by their id instead of breaking the scan.
 */
export async function fetchDebankChainNames(
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  if (chainNameCache && Date.now() - chainNameCache.at < DEBANK_CHAIN_LIST_TTL_MS) {
    return chainNameCache.names;
  }
  for (const request of debankChainListRequests()) {
    try {
      const response = await fetchImpl(request.url, {
        method: "GET",
        cache: "no-store",
        headers: request.headers,
        signal: AbortSignal.timeout(DEBANK_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const names = parseDebankChainList(await response.json());
      if (names.size > 0) {
        chainNameCache = { names, at: Date.now() };
        return names;
      }
    } catch {
      // Try the next route; an unknown chain is not worth failing a scan over.
    }
  }
  return chainNameCache?.names ?? new Map();
}

/** Re-labels balances whose chain this app has no hand-written name for. */
function applyChainNames(
  balances: DebankBalance[],
  names: Map<string, string>,
): DebankBalance[] {
  if (names.size === 0) return balances;
  return balances.map((balance) => {
    const key = canonicalChainId(balance.chain);
    const name = names.get(key);
    return name ? { ...balance, chainLabel: name } : balance;
  });
}

export type DebankFetchResult = {
  ok: boolean;
  balances: DebankBalance[];
  /** Which endpoint answered, for the "detected via DeBank" note. */
  endpoint: string | null;
  error: string | null;
  /** HTTP status of the last rejected endpoint, when there was one. */
  status?: number | null;
  /**
   * Set when every keyless route was refused and no `DEBANK_ACCESS_KEY` is
   * configured: the fix is a (free) access key, not the wallet.
   */
  needsAccessKey: boolean;
  /** Every route that was tried, with what it said — handy in the note/log. */
  attempts: Array<{ url: string; status: number | null; note: string }>;
};

/**
 * Asks DeBank for a wallet's tokens. Never throws: a blocked, rate-limited or
 * malformed response is reported as `ok: false` so the caller can fall back to
 * reading the chains directly.
 */
export async function fetchDebankBalances(
  address: string,
  chain: string = "auto",
  fetchImpl: typeof fetch = fetch,
): Promise<DebankFetchResult> {
  const requests = debankRequests(address, chain);
  const deadline = Date.now() + DEBANK_TOTAL_BUDGET_MS;
  const attempts: DebankFetchResult["attempts"] = [];
  let lastError: string | null = null;
  let emptyAnswer = false;
  let refusal: string | null = null;
  let lastStatus: number | null = null;

  for (const request of requests) {
    const remaining = deadline - Date.now();
    if (remaining < 500) {
      attempts.push({ url: request.url, status: null, note: "skipped: out of time" });
      lastError = lastError ?? "DeBank took too long to answer";
      break;
    }
    try {
      const response = await fetchImpl(request.url, {
        method: "GET",
        cache: "no-store",
        headers: request.headers,
        signal: AbortSignal.timeout(Math.min(DEBANK_TIMEOUT_MS, remaining)),
      });
      if (!response.ok) {
        lastStatus = response.status;
        lastError = describeHttpStatus(response.status);
        attempts.push({ url: request.url, status: response.status, note: lastError });
        continue;
      }

      const payload: unknown = await response.json();
      const answer = readDebankAnswer(payload);

      if (answer.kind === "tokens") {
        let balances = parseDebankTokens(payload, { chainFilter: chain });
        if (balances.length === 0) {
          // DeBank listed tokens but every one was filtered out as dust/spam.
          emptyAnswer = true;
          attempts.push({ url: request.url, status: 200, note: "no spendable tokens" });
          continue;
        }
        // A chain DeBank added since the last release would only show up as an
        // id (`aero`); ask DeBank what it is called. Purely cosmetic, so it is
        // skipped when the scan budget is already spent.
        if (
          balances.some((balance) => !hasKnownChainLabel(balance.chain)) &&
          deadline - Date.now() > 1500
        ) {
          try {
            balances = applyChainNames(balances, await fetchDebankChainNames(fetchImpl));
          } catch {
            // Keep the id-based labels.
          }
        }
        attempts.push({ url: request.url, status: 200, note: `${balances.length} tokens` });
        return {
          ok: true,
          balances,
          endpoint: request.url,
          error: null,
          needsAccessKey: false,
          attempts,
        };
      }

      if (answer.kind === "empty") {
        // A real answer: DeBank knows the wallet and it holds nothing on the
        // chains it indexes. Still worth letting the direct read have a go —
        // DeBank does not cover every chain this app can read.
        emptyAnswer = true;
        lastError = "DeBank reports no tokens for that wallet on any chain it indexes.";
        attempts.push({ url: request.url, status: 200, note: "empty list" });
        continue;
      }

      // A refusal or an unreadable body: an error, never "the wallet is empty".
      refusal = refusal ?? answer.message;
      lastError = refusal;
      attempts.push({ url: request.url, status: 200, note: answer.message });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      lastError = detail ? `DeBank could not be reached (${detail})` : "DeBank could not be reached";
      attempts.push({ url: request.url, status: null, note: lastError });
    }
  }

  // Every route answered with an empty list. That may be the truth, or it may be
  // `is_all=false` filtering out a wallet that only holds non-core tokens — so
  // ask once for everything before giving up on DeBank.
  if (emptyAnswer && !refusal && deadline - Date.now() > 1000) {
    const request = debankAllTokensRequest(address, chain);
    try {
      const response = await fetchImpl(request.url, {
        method: "GET",
        cache: "no-store",
        headers: request.headers,
        signal: AbortSignal.timeout(Math.min(DEBANK_TIMEOUT_MS, deadline - Date.now())),
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        const answer = readDebankAnswer(payload);
        const balances =
          answer.kind === "tokens" ? parseDebankTokens(payload, { chainFilter: chain }) : [];
        if (balances.length > 0) {
          attempts.push({ url: request.url, status: 200, note: `${balances.length} tokens (all)` });
          return {
            ok: true,
            balances,
            endpoint: request.url,
            error: null,
            needsAccessKey: false,
            attempts,
          };
        }
        attempts.push({ url: request.url, status: 200, note: "empty list (all)" });
      } else {
        attempts.push({ url: request.url, status: response.status, note: describeHttpStatus(response.status) });
      }
    } catch {
      attempts.push({ url: request.url, status: null, note: "could not be reached" });
    }
  }

  const key = (process.env.DEBANK_ACCESS_KEY ?? "").trim();
  const emptyMessage = "DeBank reports no tokens for that wallet on any chain it indexes.";
  return {
    ok: false,
    balances: [],
    endpoint: null,
    // A refusal beats everything; otherwise a real "it is empty" answer beats a
    // route that merely 404'd.
    error: refusal ?? (emptyAnswer ? emptyMessage : lastError),
    status: lastStatus,
    // Keyless routes being refused or retired is exactly what an access key
    // fixes, so point at it — unless DeBank actually answered "empty".
    needsAccessKey: !key && !emptyAnswer && (Boolean(refusal) || lastStatus !== null),
    attempts,
  };
}

/** A short, human reason for a failed DeBank call. */
function describeHttpStatus(status: number): string {
  if (status === 404) return "DeBank no longer serves that endpoint (404).";
  if (status === 401 || status === 403) {
    return `DeBank refused the request (${status}) — check DEBANK_ACCESS_KEY.`;
  }
  if (status === 429) return "DeBank rate-limited the request (429).";
  return `DeBank answered ${status}.`;
}
