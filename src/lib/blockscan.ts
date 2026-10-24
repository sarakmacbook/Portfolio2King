/**
 * Blockscan balances — the multichain holdings behind <https://blockscan.com>.
 *
 * Blockscan is Etherscan's cross-chain explorer, and the API underneath it is
 * Etherscan **V2** (`api.etherscan.io/v2/api`): one key, one base URL, and a
 * `chainid` parameter to choose the network — the same pattern this app already
 * uses for Routescan. That makes it a genuine second opinion next to DeBank:
 * different indexing, different token lists, and a USD price from Etherscan's own
 * feed instead of DeBank's.
 *
 * Two kinds of call per chain:
 *
 * - `module=account&action=addresstokenbalance` — every ERC-20 the address holds,
 *   with `TokenPriceUSD`
 * - `module=account&action=balance` — the native coin, in wei
 *
 * Etherscan allows **2 requests per second** on a key, so the sweep is
 * sequential with a ~550 ms gap and a total budget; chains the budget did not
 * reach are reported back, never silently dropped. `addresstokenbalance` is also
 * a **PRO** endpoint: with a free key Etherscan answers "not available on your
 * plan", which this module reports as such instead of showing an empty wallet.
 *
 * A free key still finds tokens. When the holdings endpoint says "plan", a
 * second, free path runs for that chain:
 *
 * - `module=account&action=tokentx` — the wallet's recent ERC-20 transfers, which
 *   carry each token's contract, symbol and decimals (no price)
 * - `module=account&action=tokenbalance` — the live balance of one contract
 *
 * Both are free on every plan, so a free key sees the wallet's tokens instead of
 * only its native coin. Prices are missing from these endpoints, so the scanner
 * prices those rows through its normal market lookup. The path is capped (a
 * shared contract limit and budget) so a wallet with hundreds of tokens cannot
 * turn one scan into a hundred requests.
 *
 * Everything that shapes a response is a pure function, so it is testable
 * without a network — see tests/blockscan.test.ts.
 */

import type { CryptoCategory } from "@/db/schema";
import { isStablecoinSymbol } from "@/lib/stablecoins";
import { canonicalChainId, chainMatchesFilter } from "@/lib/wallet-chains";
import type { DebankBalance } from "@/lib/debank";

/** Etherscan V2 — the API blockscan.com itself reads. */
export const BLOCKSCAN_API_BASE = "https://api.etherscan.io/v2/api";

/** Timeout for one request (Etherscan answers slowly under load). */
export const BLOCKSCAN_TIMEOUT_MS = 8_000;

/**
 * Gap between two calls. Etherscan's limit is 2 calls/second, so 550 ms keeps a
 * whole sweep under it without a retry loop.
 */
export const BLOCKSCAN_PACE_MS = 550;

/** How long one sweep may spend in total before the remaining chains are skipped. */
export const BLOCKSCAN_TOTAL_BUDGET_MS = 12_000;

/** `addresstokenbalance` page size. */
export const BLOCKSCAN_PAGE_SIZE = 100;

/** How many tokens one scan returns, biggest first (a picker, not an archive). */
export const MAX_BLOCKSCAN_TOKENS = 250;

/** `tokentx` page size — the free-tier transfer history. */
export const BLOCKSCAN_TRANSFERS_PER_PAGE = 100;

/** How many transfer pages one chain may read (each page is one request). */
export const BLOCKSCAN_FREE_MAX_PAGES = 2;

/** How many distinct contracts the free path reads a balance for, per sweep. */
export const BLOCKSCAN_FREE_MAX_CONTRACTS = 12;

/** How long the free path may spend across a whole sweep. */
export const BLOCKSCAN_FREE_BUDGET_MS = 6_000;

export type BlockscanChain = {
  /** The app's own chain id, so the rest of the app reads naturally. */
  chain: string;
  label: string;
  /** Etherscan V2's numeric chain id. */
  id: number;
  nativeSymbol: string;
  nativeName: string;
};

/**
 * The chains a Blockscan sweep covers.
 *
 * Etherscan V2 lists 60+ chains; these are the ones this app also prices, reads
 * and shows elsewhere, so a scan does not fan out to networks the portfolio
 * cannot display. Adding one here is a one-line change — the id is Etherscan's.
 */
export const BLOCKSCAN_CHAINS: BlockscanChain[] = [
  { chain: "ethereum", label: "Ethereum", id: 1, nativeSymbol: "ETH", nativeName: "Ethereum" },
  { chain: "bsc", label: "BNB Chain", id: 56, nativeSymbol: "BNB", nativeName: "BNB" },
  { chain: "arbitrum", label: "Arbitrum", id: 42161, nativeSymbol: "ETH", nativeName: "Ethereum (Arbitrum)" },
  { chain: "base", label: "Base", id: 8453, nativeSymbol: "ETH", nativeName: "Ethereum (Base)" },
  { chain: "polygon", label: "Polygon", id: 137, nativeSymbol: "POL", nativeName: "Polygon (POL)" },
  { chain: "optimism", label: "Optimism", id: 10, nativeSymbol: "ETH", nativeName: "Ethereum (Optimism)" },
  { chain: "avalanche", label: "Avalanche", id: 43114, nativeSymbol: "AVAX", nativeName: "Avalanche" },
  { chain: "linea", label: "Linea", id: 59144, nativeSymbol: "ETH", nativeName: "Ethereum (Linea)" },
  { chain: "scroll", label: "Scroll", id: 534352, nativeSymbol: "ETH", nativeName: "Ethereum (Scroll)" },
  { chain: "zksync", label: "zkSync", id: 324, nativeSymbol: "ETH", nativeName: "Ethereum (zkSync)" },
  { chain: "mantle", label: "Mantle", id: 5000, nativeSymbol: "MNT", nativeName: "Mantle" },
  { chain: "blast", label: "Blast", id: 81457, nativeSymbol: "ETH", nativeName: "Ethereum (Blast)" },
  { chain: "gnosis", label: "Gnosis", id: 100, nativeSymbol: "XDAI", nativeName: "Gnosis (xDAI)" },
  { chain: "celo", label: "Celo", id: 42220, nativeSymbol: "CELO", nativeName: "Celo" },
];

/** The chains one sweep should ask about, respecting the dialog's chain filter. */
export function blockscanChainsFor(chainFilter: string): BlockscanChain[] {
  if (!chainFilter || chainFilter === "auto") return BLOCKSCAN_CHAINS;
  return BLOCKSCAN_CHAINS.filter((spec) => chainMatchesFilter(spec.chain, chainFilter));
}

/** `addresstokenbalance` URL for one account on one chain. */
export function blockscanTokenUrl(
  chainId: number,
  address: string,
  apiKey: string,
  page = 1,
): string {
  return `${BLOCKSCAN_API_BASE}?chainid=${chainId}&module=account&action=addresstokenbalance&address=${encodeURIComponent(
    address,
  )}&page=${page}&offset=${BLOCKSCAN_PAGE_SIZE}&apikey=${encodeURIComponent(apiKey)}`;
}

/** Native-balance URL for one account on one chain. */
export function blockscanNativeUrl(chainId: number, address: string, apiKey: string): string {
  return `${BLOCKSCAN_API_BASE}?chainid=${chainId}&module=account&action=balance&address=${encodeURIComponent(
    address,
  )}&tag=latest&apikey=${encodeURIComponent(apiKey)}`;
}

/**
 * `action=tokentx` URL — the wallet's ERC-20 transfers on one chain, newest
 * first. Free on every plan; each row names the token's contract, symbol and
 * decimals.
 */
export function blockscanTokenTransfersUrl(
  chainId: number,
  address: string,
  apiKey: string,
  page = 1,
): string {
  return `${BLOCKSCAN_API_BASE}?chainid=${chainId}&module=account&action=tokentx&address=${encodeURIComponent(
    address,
  )}&page=${page}&offset=${BLOCKSCAN_TRANSFERS_PER_PAGE}&sort=desc&apikey=${encodeURIComponent(apiKey)}`;
}

/** `action=tokenbalance` URL for one contract — free on every plan. */
export function blockscanTokenBalanceUrl(
  chainId: number,
  contract: string,
  address: string,
  apiKey: string,
): string {
  return `${BLOCKSCAN_API_BASE}?chainid=${chainId}&module=account&action=tokenbalance&contractaddress=${encodeURIComponent(
    contract,
  )}&address=${encodeURIComponent(address)}&tag=latest&apikey=${encodeURIComponent(apiKey)}`;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

function numberOf(value: unknown): number {
  const raw = typeof value === "string" ? value.replace(/,/g, "") : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A 0x-prefixed 40-hex contract, else `null`. */
function evmContract(value: unknown): string | null {
  const candidate = text(value).trim();
  return /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate : null;
}

/** The `result` array of a successful answer, or an empty list. */
function resultItems(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as Record<string, unknown>).result;
  return Array.isArray(result) ? result : [];
}

/**
 * Why Etherscan refused, in words. Their errors are terse strings in `message`
 * and `result` ("NOTOK", "Max rate limit reached", …).
 */
export function blockscanErrorText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const message = text(record.message);
  const result = typeof record.result === "string" ? record.result : "";
  const joined = [message, result].filter(Boolean).join(" — ");
  return joined.replace(/^NOTOK\s*—\s*/, "");
}

/** Etherscan's wording when the key itself is wrong or missing. */
const KEY_REJECTION_RE =
  /invalid api key|missing.*api key|api key.*(?:invalid|missing|required)|apikey.*(?:invalid|missing)/;

/** Etherscan's wording when the endpoint is not in the key's plan. */
const PLAN_RESTRICTION_RE =
  /not (?:available|supported) on your plan|upgrade|pro plan|pro endpoint|subscription|paid plan/;

/** A token a transfer history mentioned — enough to ask for its balance. */
export type BlockscanTokenRef = {
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
};

/**
 * The distinct tokens in an `action=tokentx` answer, newest first.
 *
 * One token appears in many transfers, so rows are de-duplicated by contract.
 * `tokenDecimal` comes from the row because `tokenbalance` answers in base units —
 * without it a 6-decimal token would read a million times too large.
 */
export function parseBlockscanTokenTransfers(payload: unknown): BlockscanTokenRef[] {
  const seen = new Set<string>();
  const tokens: BlockscanTokenRef[] = [];

  for (const raw of resultItems(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;

    const contract = evmContract(row.contractAddress ?? row.ContractAddress);
    if (!contract) continue;
    const key = contract.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const decimals = Math.max(
      0,
      Math.min(36, Math.round(numberOf(row.tokenDecimal ?? row.TokenDecimal) || 18)),
    );
    const symbol = text(row.tokenSymbol ?? row.TokenSymbol).trim().toUpperCase() || "TOKEN";
    const name = text(row.tokenName ?? row.TokenName).trim() || symbol;

    tokens.push({ contract, symbol, name, decimals });
  }

  return tokens;
}

export type BlockscanTransfersAnswer = {
  ok: boolean;
  tokens: BlockscanTokenRef[];
  error?: string;
  needsKey?: boolean;
  proOnly?: boolean;
};

/**
 * Reads one `action=tokentx` answer. "No transactions found" is an answer — the
 * wallet has no ERC-20 history on that chain — while a rejected key, a plan
 * restriction and a rate limit are failures with their own wording.
 */
export function readBlockscanTransfers(payload: unknown): BlockscanTransfersAnswer {
  if (!payload || typeof payload !== "object") {
    return { ok: false, tokens: [], error: "Blockscan sent no answer." };
  }

  const record = payload as Record<string, unknown>;
  const status = text(record.status);
  const reason = blockscanErrorText(payload);
  const lower = reason.toLowerCase();

  if (KEY_REJECTION_RE.test(lower)) {
    return { ok: false, tokens: [], error: "Blockscan rejected the API key.", needsKey: true };
  }
  if (PLAN_RESTRICTION_RE.test(lower)) {
    return {
      ok: false,
      tokens: [],
      error: "This Etherscan plan does not include the transfer history either.",
      proOnly: true,
    };
  }
  if (status === "0" && /no (?:token|tokens|record|records|transaction)/i.test(lower)) {
    return { ok: true, tokens: [] };
  }
  if (status === "0" && reason) {
    return { ok: false, tokens: [], error: reason };
  }

  return { ok: true, tokens: parseBlockscanTokenTransfers(payload) };
}

/** The base-unit balance from an `action=tokenbalance` answer, or 0. */
export function parseBlockscanTokenQuantity(payload: unknown, decimals = 18): number {
  if (!payload || typeof payload !== "object") return 0;
  const result = (payload as Record<string, unknown>).result;
  if (typeof result !== "string" && typeof result !== "number") return 0;
  const raw = Number(result);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const quantity = raw / 10 ** Math.max(0, Math.min(36, decimals));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

/** Shapes one chain's `addresstokenbalance` answer into balances. */
export function parseBlockscanTokenBalances(
  payload: unknown,
  spec: Pick<BlockscanChain, "chain" | "label">,
  maxItems = MAX_BLOCKSCAN_TOKENS,
): DebankBalance[] {
  const balances: DebankBalance[] = [];
  const seen = new Set<string>();

  for (const raw of resultItems(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;

    const contract = evmContract(row.TokenAddress ?? row.tokenAddress ?? row.contractAddress);
    const symbol = text(row.TokenSymbol ?? row.tokenSymbol).trim().toUpperCase();
    if (!contract || !symbol) continue;

    const divisor = Math.max(
      0,
      Math.min(36, Math.round(numberOf(row.TokenDivisor ?? row.tokenDivisor) || 18)),
    );
    const quantity = numberOf(row.TokenQuantity ?? row.tokenQuantity) / 10 ** divisor;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const key = contract.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const price = numberOf(row.TokenPriceUSD ?? row.tokenPriceUSD);
    const name = text(row.TokenName ?? row.tokenName).trim() || symbol;
    const category: CryptoCategory = isStablecoinSymbol(symbol) ? "stablecoin" : "volatile";

    balances.push({
      id: `blockscan:${spec.chain}:${key}`,
      symbol,
      name,
      chain: spec.chain,
      chainLabel: spec.label,
      quantity: Number(quantity.toFixed(8)),
      price,
      valueUsd: Number((quantity * price).toFixed(2)),
      category,
      contract,
      // Blockscan does not send artwork; the picker falls back to its own icons.
      logoUrl: "",
    });
  }

  return balances.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, maxItems);
}

export type BlockscanAnswer = {
  ok: boolean;
  balances: DebankBalance[];
  error?: string;
  /** The key is missing or rejected. */
  needsKey?: boolean;
  /** The key is fine, but `addresstokenbalance` is not in the plan. */
  proOnly?: boolean;
};

/**
 * Reads one chain's answer.
 *
 * "No tokens found" is an answer, not a failure — this wallet holds nothing on
 * that chain. A missing key, a free key hitting a PRO endpoint and a rate limit
 * are failures, and each one is named so the dialog can explain it.
 */
export function readBlockscanAnswer(
  payload: unknown,
  spec: Pick<BlockscanChain, "chain" | "label">,
  maxItems = MAX_BLOCKSCAN_TOKENS,
): BlockscanAnswer {
  if (!payload || typeof payload !== "object") {
    return { ok: false, balances: [], error: "Blockscan sent no answer." };
  }

  const record = payload as Record<string, unknown>;
  const status = text(record.status);
  const reason = blockscanErrorText(payload);
  const lower = reason.toLowerCase();

  if (KEY_REJECTION_RE.test(lower)) {
    return { ok: false, balances: [], error: "Blockscan rejected the API key.", needsKey: true };
  }
  if (PLAN_RESTRICTION_RE.test(lower)) {
    return {
      ok: false,
      balances: [],
      error: "Token holdings need a paid Etherscan plan on this key.",
      proOnly: true,
    };
  }
  // A wallet that holds nothing on this chain — not a failure.
  if (status === "0" && /no (?:token|tokens|record|records|transaction)/i.test(lower)) {
    return { ok: true, balances: [] };
  }
  if (status === "0" && reason) {
    return { ok: false, balances: [], error: reason };
  }

  return { ok: true, balances: parseBlockscanTokenBalances(payload, spec, maxItems) };
}

/** The native coin from an `action=balance` answer, or 0. */
export function parseBlockscanNativeBalance(payload: unknown, decimals = 18): number {
  if (!payload || typeof payload !== "object") return 0;
  const result = (payload as Record<string, unknown>).result;
  const wei = typeof result === "string" || typeof result === "number" ? Number(result) : 0;
  if (!Number.isFinite(wei) || wei <= 0) return 0;
  return wei / 10 ** decimals;
}

/** The key, from either name this app accepts. */
export function blockscanApiKey(env: Record<string, string | undefined> = process.env): string {
  return (env.ETHERSCAN_API_KEY ?? env.BLOCKSCAN_API_KEY ?? "").trim();
}

export const BLOCKSCAN_NEEDS_KEY_MESSAGE =
  "Blockscan needs an Etherscan API key — add one under Scanner API keys, or set ETHERSCAN_API_KEY. A free key from etherscan.io finds tokens through the wallet's transfer history; a paid one reads them in a single call per chain.";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function getJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    // A 403/429 body still carries Etherscan's explanation, so try to read it.
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type BlockscanFreeResult = {
  ok: boolean;
  balances: DebankBalance[];
  error?: string;
  needsKey?: boolean;
  /** Contracts a balance was actually requested for (the shared budget). */
  readContracts: number;
  /** Contracts the transfer history named that were not read. */
  unreadContracts: number;
};

/**
 * The free-tier token path for one chain: transfer history → contracts → the
 * balance of each.
 *
 * Used only when `addresstokenbalance` is not in the key's plan. Prices are not
 * part of either endpoint, so every row comes back unpriced (`price: 0`) and the
 * scanner fills the value in with its normal market lookup. `deadline` and
 * `maxContracts` are shared across a whole sweep, so one busy wallet cannot spend
 * the budget on a single chain.
 */
export async function fetchBlockscanFreeTokens(
  address: string,
  spec: BlockscanChain,
  options: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    paceMs?: number;
    maxContracts?: number;
    maxPages?: number;
    deadline?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<BlockscanFreeResult> {
  const apiKey = options.apiKey.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BLOCKSCAN_TIMEOUT_MS;
  const paceMs = options.paceMs ?? BLOCKSCAN_PACE_MS;
  const maxContracts = Math.max(0, options.maxContracts ?? BLOCKSCAN_FREE_MAX_CONTRACTS);
  const maxPages = Math.max(1, options.maxPages ?? BLOCKSCAN_FREE_MAX_PAGES);
  const deadline = options.deadline ?? Date.now() + BLOCKSCAN_FREE_BUDGET_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  if (!apiKey) {
    return {
      ok: false,
      balances: [],
      needsKey: true,
      readContracts: 0,
      unreadContracts: 0,
      error: BLOCKSCAN_NEEDS_KEY_MESSAGE,
    };
  }
  if (maxContracts === 0) {
    return { ok: true, balances: [], readContracts: 0, unreadContracts: 0 };
  }

  const refs: BlockscanTokenRef[] = [];
  const seen = new Set<string>();
  let firstError = "";

  for (let page = 1; page <= maxPages; page += 1) {
    if (now() >= deadline) break;
    const payload = await getJson(
      blockscanTokenTransfersUrl(spec.id, address, apiKey, page),
      fetchImpl,
      timeoutMs,
    );
    const answer = readBlockscanTransfers(payload);
    if (!answer.ok) {
      // A key/plan problem is worth reporting; an older page failing is not.
      if (!firstError) firstError = answer.error ?? "";
      if (answer.needsKey) {
        return {
          ok: false,
          balances: [],
          needsKey: true,
          readContracts: 0,
          unreadContracts: 0,
          error: answer.error,
        };
      }
      break;
    }
    for (const ref of answer.tokens) {
      const key = ref.contract.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
    // A short page is the end of the history: no need to ask for another.
    if (answer.tokens.length < BLOCKSCAN_TRANSFERS_PER_PAGE) break;
    if (paceMs > 0 && page < maxPages) await sleep(paceMs);
  }

  if (refs.length === 0) {
    return {
      ok: !firstError,
      balances: [],
      readContracts: 0,
      unreadContracts: 0,
      ...(firstError ? { error: firstError } : {}),
    };
  }

  const balances: DebankBalance[] = [];
  let readContracts = 0;
  for (const ref of refs) {
    if (readContracts >= maxContracts) break;
    if (now() >= deadline) break;
    const payload = await getJson(
      blockscanTokenBalanceUrl(spec.id, ref.contract, address, apiKey),
      fetchImpl,
      timeoutMs,
    );
    readContracts += 1;
    const quantity = parseBlockscanTokenQuantity(payload, ref.decimals);
    if (quantity > 0) {
      balances.push({
        id: `blockscan:${spec.chain}:${ref.contract.toLowerCase()}`,
        symbol: ref.symbol,
        name: ref.name,
        chain: spec.chain,
        chainLabel: spec.label,
        quantity: Number(quantity.toFixed(8)),
        // Both endpoints are price-free; the scanner prices these rows.
        price: 0,
        valueUsd: 0,
        category: isStablecoinSymbol(ref.symbol) ? "stablecoin" : "volatile",
        contract: ref.contract,
        logoUrl: "",
      });
    }
    if (paceMs > 0 && readContracts < maxContracts && now() < deadline) await sleep(paceMs);
  }

  return {
    ok: true,
    balances,
    readContracts,
    unreadContracts: Math.max(0, refs.length - readContracts),
    ...(firstError && balances.length === 0 ? { error: firstError } : {}),
  };
}

export type BlockscanScan = {
  /** True when at least one chain answered with data. */
  ok: boolean;
  balances: DebankBalance[];
  error?: string;
  needsKey?: boolean;
  proOnly?: boolean;
  /**
   * Chains whose tokens came from the free transfer-history path because the
   * key's plan does not include the holdings endpoint.
   */
  freeFallbackChains?: string[];
  /** Contracts the free path could not read before its budget ran out. */
  freeUnreadContracts?: number;
  /** Chains that answered. */
  answeredChains: number;
  /** Chains that were asked. */
  checkedChains: string[];
  /** Chains the time budget or the chain filter left out. */
  skippedChains: string[];
};

/**
 * Sweeps every chain for one address.
 *
 * Sequential and paced on purpose: Etherscan allows 2 calls/second on a key, so
 * firing fourteen chains at once would earn a rate limit instead of balances.
 * The native coin is read only when the scan is narrowed to one chain — on a
 * whole-wallet sweep the direct on-chain read already supplies native balances,
 * and spending the budget on them would halve the token coverage.
 */
export async function fetchBlockscanBalances(
  address: string,
  options: {
    chainFilter?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    paceMs?: number;
    budgetMs?: number;
    maxItems?: number;
    chains?: BlockscanChain[];
    /** Shared contract limit for the free path (0 disables it). */
    maxFreeContracts?: number;
    /** Shared budget for the free path. */
    freeBudgetMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<BlockscanScan> {
  const chainFilter = options.chainFilter ?? "auto";
  const chains = options.chains ?? blockscanChainsFor(chainFilter);
  const apiKey = (options.apiKey ?? blockscanApiKey()).trim();

  if (!apiKey) {
    return {
      ok: false,
      balances: [],
      answeredChains: 0,
      checkedChains: [],
      skippedChains: chains.map((spec) => spec.chain),
      needsKey: true,
      error: BLOCKSCAN_NEEDS_KEY_MESSAGE,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BLOCKSCAN_TIMEOUT_MS;
  const paceMs = options.paceMs ?? BLOCKSCAN_PACE_MS;
  const budgetMs = options.budgetMs ?? BLOCKSCAN_TOTAL_BUDGET_MS;
  const maxItems = options.maxItems ?? MAX_BLOCKSCAN_TOKENS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const wantsNative = chains.length === 1;

  const balances: DebankBalance[] = [];
  const checkedChains: string[] = [];
  const skippedChains: string[] = [];
  let answeredChains = 0;
  let needsKey = false;
  let proOnly = false;
  let firstError = "";
  const started = now();
  // The free path has its own shared budget and contract limit: when the key's
  // plan has no holdings endpoint, tokens are still found through `tokentx` +
  // `tokenbalance`, but never at the cost of the whole sweep.
  let freeContractsLeft = Math.max(0, options.maxFreeContracts ?? BLOCKSCAN_FREE_MAX_CONTRACTS);
  const freeBudgetMs = options.freeBudgetMs ?? BLOCKSCAN_FREE_BUDGET_MS;
  let freeStarted: number | null = null;
  let freeUnreadContracts = 0;
  const freeFallbackChains: string[] = [];

  for (const spec of chains) {
    if (now() - started >= budgetMs) {
      skippedChains.push(spec.chain);
      continue;
    }

    const tokenPayload = await getJson(
      blockscanTokenUrl(spec.id, address, apiKey),
      fetchImpl,
      timeoutMs,
    );
    checkedChains.push(spec.chain);

    const answer = readBlockscanAnswer(tokenPayload, spec, maxItems);
    if (answer.ok) answeredChains += 1;
    if (answer.needsKey) needsKey = true;
    if (answer.proOnly) {
      proOnly = true;
      /**
       * A free key cannot read holdings, but `tokentx` and `tokenbalance` are
       * free on every plan — so the wallet's transfer history is turned into the
       * tokens it holds instead of answering "paid plan" and stopping there.
       */
      if (freeContractsLeft > 0 && now() - started < budgetMs) {
        freeStarted ??= now();
        const free = await fetchBlockscanFreeTokens(address, spec, {
          apiKey,
          fetchImpl,
          timeoutMs,
          paceMs,
          maxContracts: freeContractsLeft,
          deadline: freeStarted + freeBudgetMs,
          sleep,
          now,
        });
        freeContractsLeft -= free.readContracts;
        freeUnreadContracts += free.unreadContracts;
        if (free.needsKey) needsKey = true;
        if (free.balances.length > 0) {
          balances.push(...free.balances);
          answeredChains += 1;
          freeFallbackChains.push(spec.chain);
        }
        if (free.error && !firstError) firstError = free.error;
      }
    } else if (!answer.ok && answer.error && !firstError) {
      firstError = answer.error;
    }
    balances.push(...answer.balances);

    if (paceMs > 0) await sleep(paceMs);

    if (wantsNative) {
      const nativePayload = await getJson(
        blockscanNativeUrl(spec.id, address, apiKey),
        fetchImpl,
        timeoutMs,
      );
      const native = parseBlockscanNativeBalance(nativePayload);
      if (native > 0) {
        balances.push({
          id: `blockscan:${spec.chain}:native`,
          symbol: spec.nativeSymbol,
          name: spec.nativeName,
          chain: spec.chain,
          chainLabel: spec.label,
          quantity: native,
          // Priced by the scanner's market lookup, like any unpriced balance.
          price: 0,
          valueUsd: 0,
          category: "volatile",
          contract: null,
          logoUrl: "",
        });
      }
    }
  }

  const sorted = balances.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, maxItems);

  if (answeredChains === 0) {
    return {
      ok: false,
      balances: sorted,
      answeredChains,
      checkedChains,
      skippedChains,
      ...(needsKey ? { needsKey: true } : {}),
      ...(proOnly ? { proOnly: true } : {}),
      ...(freeUnreadContracts > 0 ? { freeUnreadContracts } : {}),
      error: needsKey
        ? "Blockscan rejected the API key. Check the Etherscan key in Scanner API keys."
        : proOnly
          ? "Blockscan answered, but token holdings need a paid Etherscan plan on this key, and its free transfer history found no tokens either."
          : firstError || "Blockscan did not answer for any chain.",
    };
  }

  return {
    ok: true,
    balances: sorted,
    answeredChains,
    checkedChains,
    skippedChains,
    ...(proOnly ? { proOnly: true } : {}),
    ...(freeFallbackChains.length > 0 ? { freeFallbackChains } : {}),
    ...(freeUnreadContracts > 0 ? { freeUnreadContracts } : {}),
    ...(firstError && sorted.length === 0 ? { error: firstError } : {}),
  };
}

/** The Blockscan chain id for the app's chain vocabulary, for a one-chain read. */
export function blockscanChainId(chain: string): number | null {
  const wanted = canonicalChainId(chain);
  return BLOCKSCAN_CHAINS.find((spec) => canonicalChainId(spec.chain) === wanted)?.id ?? null;
}
