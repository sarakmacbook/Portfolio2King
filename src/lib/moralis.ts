/**
 * Moralis balances — the third token source, and the one that answers the
 * "junk tokens" problem at the root.
 *
 * DeBank and Etherscan tell you *what* a wallet holds; Moralis also tells you
 * whether the token is a scam. Every row comes back with `possible_spam`,
 * `verified_contract` and a `security_score`, so an airdropped look-alike can be
 * marked as such instead of being discovered by matching words in its name.
 * Nothing is dropped here: a flagged token is returned with `spam: true`, which
 * the picker already counts and can show again on request.
 *
 * One endpoint does the work:
 *
 *   GET https://deep-index.moralis.io/api/v2.2/wallets/{address}/tokens?chain=…
 *
 * with `X-API-Key`. One call per chain, each returning quantity, USD price,
 * value, logo, decimals and the spam verdict. `exclude_spam` is deliberately
 * **not** sent: excluding would make a scam token vanish silently, and this app
 * always counts what it hides.
 *
 * Everything that shapes a response is pure, so it is testable without a
 * network — see tests/moralis.test.ts.
 */

import type { CryptoCategory } from "@/db/schema";
import { isStablecoinSymbol } from "@/lib/stablecoins";
import { canonicalChainId, chainMatchesFilter } from "@/lib/wallet-chains";
import type { DebankBalance } from "@/lib/debank";

export const MORALIS_API_BASE = "https://deep-index.moralis.io/api/v2.2";

/** One request may not take longer than this. */
export const MORALIS_TIMEOUT_MS = 8_000;

/** How long one sweep may spend in total. */
export const MORALIS_TOTAL_BUDGET_MS = 12_000;

/** How many chains are asked at the same time (Moralis rate limits per plan). */
export const MORALIS_CONCURRENCY = 3;

/** The most tokens one scan returns, biggest first. */
export const MAX_MORALIS_TOKENS = 250;

export type MoralisChain = {
  /** The app's own chain id. */
  chain: string;
  label: string;
  /** Moralis' name for the chain (`eth`, `polygon`, …). */
  slug: string;
  nativeSymbol: string;
};

/**
 * The chains a Moralis sweep covers — the ones this app also prices and shows.
 * Moralis supports more; adding one here is a one-line change.
 */
export const MORALIS_CHAINS: MoralisChain[] = [
  { chain: "ethereum", label: "Ethereum", slug: "eth", nativeSymbol: "ETH" },
  { chain: "bsc", label: "BNB Chain", slug: "bsc", nativeSymbol: "BNB" },
  { chain: "polygon", label: "Polygon", slug: "polygon", nativeSymbol: "POL" },
  { chain: "arbitrum", label: "Arbitrum", slug: "arbitrum", nativeSymbol: "ETH" },
  { chain: "base", label: "Base", slug: "base", nativeSymbol: "ETH" },
  { chain: "optimism", label: "Optimism", slug: "optimism", nativeSymbol: "ETH" },
  { chain: "avalanche", label: "Avalanche", slug: "avalanche", nativeSymbol: "AVAX" },
  { chain: "gnosis", label: "Gnosis", slug: "gnosis", nativeSymbol: "XDAI" },
  { chain: "linea", label: "Linea", slug: "linea", nativeSymbol: "ETH" },
  { chain: "scroll", label: "Scroll", slug: "scroll", nativeSymbol: "ETH" },
  { chain: "zksync", label: "zkSync", slug: "zksync", nativeSymbol: "ETH" },
  { chain: "mantle", label: "Mantle", slug: "mantle", nativeSymbol: "MNT" },
  { chain: "blast", label: "Blast", slug: "blast", nativeSymbol: "ETH" },
  { chain: "celo", label: "Celo", slug: "celo", nativeSymbol: "CELO" },
];

/** The chains one sweep should ask about, respecting the API's chain filter. */
export function moralisChainsFor(chainFilter: string): MoralisChain[] {
  if (!chainFilter || chainFilter === "auto") return MORALIS_CHAINS;
  return MORALIS_CHAINS.filter((spec) => chainMatchesFilter(spec.chain, chainFilter));
}

/** The Moralis slug for one of the app's chains, or `null`. */
export function moralisChainSlug(chain: string): string | null {
  const wanted = canonicalChainId(chain);
  return MORALIS_CHAINS.find((spec) => canonicalChainId(spec.chain) === wanted)?.slug ?? null;
}

/** The token-balances URL for one account on one chain. */
export function moralisTokensUrl(address: string, slug: string, limit = 100): string {
  const query = new URLSearchParams({ chain: slug, limit: String(limit) });
  // Spam and unverified contracts are *kept*: the app marks and counts what it
  // hides, so nothing may be excluded server-side.
  query.set("exclude_spam", "false");
  return `${MORALIS_API_BASE}/wallets/${encodeURIComponent(address)}/tokens?${query.toString()}`;
}

export function moralisApiKey(env: Record<string, string | undefined> = process.env): string {
  return (env.MORALIS_API_KEY ?? env.MORALIS_APIKEY ?? "").trim();
}

export const MORALIS_NEEDS_KEY_MESSAGE =
  "Moralis needs an API key (MORALIS_API_KEY). A free key from moralis.com covers every chain this app scans.";

function text(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

function numberOf(value: unknown): number {
  const raw = typeof value === "string" ? value.replace(/,/g, "") : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The placeholder Moralis uses for a chain's native coin. */
const NATIVE_PLACEHOLDER_RE = /^0x0{40}$|^0x[ef]{40}$/i;

/** A 0x-prefixed 40-hex contract, else `null` (native coins have none). */
function evmContract(value: unknown): string | null {
  const candidate = text(value).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) return null;
  if (NATIVE_PLACEHOLDER_RE.test(candidate)) return null;
  return candidate;
}

/** The `result` array of an answer, or an empty list. */
function resultItems(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as Record<string, unknown>).result;
  return Array.isArray(result) ? result : [];
}

export type MoralisAnswer = {
  ok: boolean;
  balances: DebankBalance[];
  error?: string;
  /** The key is missing or was rejected. */
  needsKey?: boolean;
  /** The account has more tokens than one page; `cursor` continues. */
  cursor?: string;
};

/**
 * Shapes one chain's token list.
 *
 * `possible_spam` is the whole point of this source: it becomes `spam`, which the
 * picker hides with a count and a *show them* link instead of silently dropping.
 */
export function parseMoralisTokens(
  payload: unknown,
  spec: Pick<MoralisChain, "chain" | "label">,
  maxItems = MAX_MORALIS_TOKENS,
): DebankBalance[] {
  const balances: DebankBalance[] = [];
  const seen = new Set<string>();

  for (const raw of resultItems(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;

    const symbol = text(row.symbol ?? row.token_symbol).trim().toUpperCase();
    if (!symbol) continue;

    const contract = evmContract(row.token_address ?? row.tokenAddress ?? row.address);
    const isNative = row.native_token === true || contract === null;

    const decimals = Math.max(
      0,
      Math.min(36, Math.round(numberOf(row.decimals) || 18)),
    );
    const formatted = numberOf(row.balance_formatted);
    const quantity =
      formatted > 0 ? formatted : numberOf(row.balance) / 10 ** decimals;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const key = contract ? contract.toLowerCase() : `native:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const price = numberOf(row.usd_price);
    const valueUsd = numberOf(row.usd_value) || quantity * price;
    const name = text(row.name).trim() || symbol;
    const category: CryptoCategory = isStablecoinSymbol(symbol) ? "stablecoin" : "volatile";

    balances.push({
      id: `moralis:${spec.chain}:${key}`,
      symbol,
      name,
      chain: spec.chain,
      chainLabel: spec.label,
      quantity: Number(quantity.toFixed(8)),
      price,
      valueUsd: Number(valueUsd.toFixed(2)),
      category,
      contract: isNative ? null : contract,
      logoUrl: text(row.logo ?? row.thumbnail),
      ...(row.possible_spam === true ? { spam: true } : {}),
    });
  }

  return balances.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, maxItems);
}

/**
 * Reads one chain's answer, including the two refusals worth explaining: a
 * missing/rejected key, and a plan that will not answer.
 */
export function readMoralisAnswer(
  payload: unknown,
  spec: Pick<MoralisChain, "chain" | "label">,
  maxItems = MAX_MORALIS_TOKENS,
): MoralisAnswer {
  if (payload === null || payload === undefined) {
    return { ok: false, balances: [], error: "Moralis sent no answer." };
  }
  if (typeof payload !== "object") {
    return { ok: false, balances: [], error: "Moralis sent an answer that could not be read." };
  }

  const record = payload as Record<string, unknown>;
  const errorMessage = text(record.message ?? record.error).trim();
  if (errorMessage && !Array.isArray(record.result)) {
    const lower = errorMessage.toLowerCase();
    if (/api key|apikey|unauthorized|authorization|invalid key/.test(lower)) {
      return { ok: false, balances: [], error: "Moralis rejected the API key.", needsKey: true };
    }
    return { ok: false, balances: [], error: errorMessage };
  }

  return {
    ok: true,
    balances: parseMoralisTokens(payload, spec, maxItems),
    ...(typeof record.cursor === "string" && record.cursor ? { cursor: record.cursor } : {}),
  };
}

export type MoralisScan = {
  ok: boolean;
  balances: DebankBalance[];
  error?: string;
  needsKey?: boolean;
  /** Chains that answered at all. */
  answeredChains: number;
  /** Chains the budget left out. */
  skippedChains: string[];
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
      headers: { Accept: "application/json", "X-API-Key": apiKey },
      cache: "no-store",
    });
    // Errors from Moralis are JSON too (`{"message": …}`), so read either way.
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads every chain for one address.
 *
 * A handful of requests run at a time rather than all fourteen at once, and the
 * budget stops the sweep from crawling on a slow network. A chain that fails is
 * reported, never treated as "this wallet holds nothing there".
 */
export async function fetchMoralisBalances(
  address: string,
  options: {
    chainFilter?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    budgetMs?: number;
    maxItems?: number;
    chains?: MoralisChain[];
    concurrency?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<MoralisScan> {
  const chains = options.chains ?? moralisChainsFor(options.chainFilter ?? "auto");
  const apiKey = (options.apiKey ?? moralisApiKey()).trim();

  if (!apiKey) {
    return {
      ok: false,
      balances: [],
      answeredChains: 0,
      skippedChains: chains.map((spec) => spec.chain),
      needsKey: true,
      error: MORALIS_NEEDS_KEY_MESSAGE,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MORALIS_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? MORALIS_TOTAL_BUDGET_MS;
  const maxItems = options.maxItems ?? MAX_MORALIS_TOKENS;
  const concurrency = Math.max(1, options.concurrency ?? MORALIS_CONCURRENCY);
  const now = options.now ?? Date.now;
  const started = now();

  const balances: DebankBalance[] = [];
  const skippedChains: string[] = [];
  let answeredChains = 0;
  let needsKey = false;
  let firstError = "";

  const queue = [...chains];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const spec = queue.shift();
      if (!spec) return;
      if (now() - started >= budgetMs) {
        skippedChains.push(spec.chain);
        continue;
      }
      const payload = await getJson(
        moralisTokensUrl(address, spec.slug),
        apiKey,
        fetchImpl,
        timeoutMs,
      );
      const answer = readMoralisAnswer(payload, spec, maxItems);
      if (answer.ok) answeredChains += 1;
      if (answer.needsKey) needsKey = true;
      if (!answer.ok && answer.error && !firstError) firstError = answer.error;
      balances.push(...answer.balances);
    }
  });
  await Promise.all(workers);

  const sorted = balances.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, maxItems);

  if (answeredChains === 0) {
    return {
      ok: false,
      balances: sorted,
      answeredChains,
      skippedChains,
      ...(needsKey ? { needsKey: true } : {}),
      error: needsKey
        ? "Moralis rejected the API key. Check MORALIS_API_KEY."
        : firstError || "Moralis did not answer for any chain.",
    };
  }

  return { ok: true, balances: sorted, answeredChains, skippedChains };
}
