/**
 * DeBank balance detection.
 *
 * DeBank indexes every EVM chain and returns the tokens a wallet holds with
 * their USD price, which is exactly what "Add via wallet address" needs: one
 * call instead of an RPC round-trip per chain and a price lookup per ticker.
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
import { WALLET_CHAIN_LABELS, type WalletChain } from "@/lib/wallet-chains";

export const DEBANK_TIMEOUT_MS = 6000;

/**
 * How long one scan may spend on DeBank overall. Three keyless routes at six
 * seconds each would make the wallet dialog crawl when they are all blocked, so
 * the remaining routes are skipped once the budget is gone (the on-chain read
 * then takes over).
 */
export const DEBANK_TOTAL_BUDGET_MS = 12000;

/** How many tokens one scan may return (protects the picker from spam airdrops). */
export const MAX_DEBANK_TOKENS = 100;

type ScannedChain = Exclude<WalletChain, "auto">;

/** DeBank chain id → the chain vocabulary used by the app. */
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
  linea: "linea",
  scr: "scroll",
  scroll: "scroll",
  mnt: "mantle",
  mantle: "mantle",
  blast: "blast",
  ftm: "fantom",
  fantom: "fantom",
  gno: "gnosis",
  gnosis: "gnosis",
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

/** The DeBank chain id for an app chain, or `null` when it is not an EVM chain. */
export function debankChainIdFor(chain: WalletChain): string | null {
  if (chain === "auto") return null;
  return WALLET_CHAIN_TO_DEBANK[chain] ?? null;
}

/** The app chain for a DeBank chain id (accepts both short and long ids). */
export function walletChainFromDebankId(id: unknown): ScannedChain | null {
  if (typeof id !== "string") return null;
  return DEBANK_CHAIN_IDS[id.trim().toLowerCase()] ?? null;
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
 * Shapes a DeBank token list into balances: drops empty, worthless spam (unless
 * DeBank marks it core/verified), de-duplicates the same token seen twice and
 * sorts by USD value.
 */
export function parseDebankTokens(
  payload: unknown,
  options: { chainFilter?: WalletChain; maxItems?: number } = {},
): DebankBalance[] {
  const chainFilter =
    options.chainFilter && options.chainFilter !== "auto" ? options.chainFilter : null;
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
    if (chainFilter && chain !== chainFilter) continue;
    // DeBank only indexes the EVM side; non-EVM chains cannot appear here.
    if (chain === "solana" || chain === "bitcoin" || chain === "tron") continue;

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
      chainLabel: WALLET_CHAIN_LABELS[chain],
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
  chain: WalletChain = "auto",
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

export type DebankFetchResult = {
  ok: boolean;
  balances: DebankBalance[];
  /** Which endpoint answered, for the "detected via DeBank" note. */
  endpoint: string | null;
  error: string | null;
  /** HTTP status of the last rejected endpoint, when there was one. */
  status?: number | null;
};

/**
 * Asks DeBank for a wallet's tokens. Never throws: a blocked, rate-limited or
 * malformed response is reported as `ok: false` so the caller can fall back to
 * reading the chains directly.
 */
export async function fetchDebankBalances(
  address: string,
  chain: WalletChain = "auto",
  fetchImpl: typeof fetch = fetch,
): Promise<DebankFetchResult> {
  const requests = debankRequests(address, chain);
  const deadline = Date.now() + DEBANK_TOTAL_BUDGET_MS;
  let lastError: string | null = null;
  let sawEmptyAnswer = false;
  let lastStatus: number | null = null;

  for (const request of requests) {
    const remaining = deadline - Date.now();
    if (remaining < 500) {
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
        continue;
      }
      const payload: unknown = await response.json();
      const balances = parseDebankTokens(payload, { chainFilter: chain });
      if (balances.length > 0) {
        return { ok: true, balances, endpoint: request.url, error: null };
      }
      // A 200 with nothing in it means "DeBank knows this wallet and it is
      // empty", which is a better answer than the next endpoint's 404.
      sawEmptyAnswer = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      lastError = detail ? `DeBank could not be reached (${detail})` : "DeBank could not be reached";
    }
  }

  return {
    ok: false,
    balances: [],
    endpoint: null,
    error: sawEmptyAnswer ? "DeBank returned no tokens for that wallet." : lastError,
    status: lastStatus,
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
