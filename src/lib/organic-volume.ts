/**
 * Organic trading volume for a token contract.
 *
 * A scan can report a token at any price it likes: a freshly minted scam token
 * will happily claim $40,000. What it cannot fake as easily is a *market* — real
 * pools, real liquidity, and volume that is a plausible fraction of that
 * liquidity. This module turns DexScreener's per-pair numbers into one honest
 * figure per contract:
 *
 *   - pools below `MIN_PAIR_LIQUIDITY_USD` are ignored (dust pools anyone can
 *     create to invent trading activity)
 *   - volume above `MAX_VOLUME_TO_LIQUIDITY × liquidity` is dropped as wash
 *     trading (real venues turn over a fraction of their liquidity per day)
 *   - what is left is summed as **organic volume**, and a token only "has a
 *     market" once it clears `MIN_ORGANIC_VOLUME_USD` a day
 *   - **depth** is judged separately: a token is real at `MIN_LIQUIDITY_USD` of
 *     pooled liquidity and *deep* at `DEEP_LIQUIDITY_USD` with one pool of
 *     `MIN_DEEPEST_POOL_USD`. Liquidity is the part of a fake token that costs
 *     actual money to fake, so it is the strongest "is this real?" signal here.
 *
 * This is a heuristic, not a provider's organic-volume score, and it is treated
 * as such: when the lookup fails or the answer is missing, the token is
 * *unknown*, never "no market" — a scan must not hide a real holding because
 * DexScreener was rate-limited.
 */

export const DEXSCREENER_BATCH_SIZE = 30;
export const MIN_PAIR_LIQUIDITY_USD = 500;
export const MAX_VOLUME_TO_LIQUIDITY = 200;
export const MIN_ORGANIC_VOLUME_USD = 100;
/** Pooled liquidity a token needs before it is treated as real. */
export const MIN_LIQUIDITY_USD = 2_000;
/** Pooled liquidity that reads as *deep* — the badge on the card. */
export const DEEP_LIQUIDITY_USD = 25_000;
/** Deep also needs one pool with real money in it, not twenty dust pools. */
export const MIN_DEEPEST_POOL_USD = 5_000;

const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";
const REQUEST_TIMEOUT_MS = 6_000;

export type MarketSignals = {
  /** Lower-case contract address these numbers belong to. */
  contract: string;
  /** Chain of the deepest pair, when DexScreener reported one. */
  chain: string | null;
  /** How many pairs the token trades in. */
  pairs: number;
  /** How many distinct DEXes those pairs are on. */
  dexes: number;
  /** Total 24h USD volume across every pair. */
  volume24hUsd: number;
  /** 24h USD volume left after dropping dust pools and wash trading. */
  organicVolume24hUsd: number;
  /** Total liquidity of the pairs that count (dust pools excluded). */
  liquidityUsd: number;
  /** Liquidity of the single deepest pool that counts. */
  deepestPoolUsd: number;
  /** Enough depth to be sure the token is real. */
  deepLiquidity: boolean;
  /**
   * The token's market capitalisation in USD, as DexScreener reports it on the
   * pairs it knows (0 when it reports none). A real token carries a real cap;
   * a token minted yesterday has none or a made-up one, so this is one of the
   * cheapest ways to tell the two apart.
   */
  marketCapUsd: number;
  /** Fully-diluted value, when DexScreener sent one (0 otherwise). */
  fdvUsd: number;
  /** True when a pool's volume was implausibly larger than its liquidity. */
  washSuspected: boolean;
  /** Organic volume clears the floor — i.e. the token is actually traded. */
  hasMarket: boolean;
};

const EMPTY: Omit<MarketSignals, "contract"> = {
  chain: null,
  pairs: 0,
  dexes: 0,
  volume24hUsd: 0,
  organicVolume24hUsd: 0,
  liquidityUsd: 0,
  deepestPoolUsd: 0,
  deepLiquidity: false,
  marketCapUsd: 0,
  fdvUsd: 0,
  washSuspected: false,
  hasMarket: false,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function amount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Sums one token's pairs into its market signals. Pure, so the trade-off between
 * "has a market" and "looks manufactured" is testable without a network.
 */
export function signalsFromPairs(pairs: readonly unknown[], contract: string): MarketSignals {
  const wanted = contract.trim().toLowerCase();
  const dexes = new Set<string>();
  let count = 0;
  let volume24hUsd = 0;
  let organicVolume24hUsd = 0;
  let liquidityUsd = 0;
  let washSuspected = false;
  let chain: string | null = null;
  let deepestLiquidity = 0;
  let deepestPoolUsd = 0;
  let marketCapUsd = 0;
  let fdvUsd = 0;

  for (const item of pairs) {
    const pair = record(item);
    if (!pair) continue;
    const base = record(pair.baseToken);
    if (!base || text(base.address).toLowerCase() !== wanted) continue;

    count += 1;
    const dex = text(pair.dexId);
    if (dex) dexes.add(dex);

    const liquidity = amount(record(pair.liquidity)?.usd);
    const volume = amount(record(pair.volume)?.h24);
    // DexScreener repeats the token's cap on every pair; the largest one is the
    // pair it prices most confidently. A missing cap (0) never overwrites one.
    const cap = amount(pair.marketCap);
    if (cap > marketCapUsd) marketCapUsd = cap;
    const fdv = amount(pair.fdv);
    if (fdv > fdvUsd) fdvUsd = fdv;
    volume24hUsd += volume;

    const holdsOnItsOwn = liquidity >= MIN_PAIR_LIQUIDITY_USD;
    const plausible = volume <= liquidity * MAX_VOLUME_TO_LIQUIDITY;
    if (volume > 0 && liquidity > 0 && !plausible) washSuspected = true;
    if (volume > 0 && liquidity === 0) washSuspected = true;

    if (holdsOnItsOwn) {
      liquidityUsd += liquidity;
      if (liquidity > deepestPoolUsd) deepestPoolUsd = liquidity;
      // A pool that trades more than a couple of hundred times its own depth in
      // a day is not organic trading; leave that volume out of the total.
      if (plausible) organicVolume24hUsd += volume;
    }

    if (liquidity > deepestLiquidity) {
      deepestLiquidity = liquidity;
      const chainId = text(pair.chainId);
      if (chainId) chain = chainId;
    }
  }

  return {
    contract: wanted,
    chain,
    pairs: count,
    dexes: dexes.size,
    volume24hUsd: Number(volume24hUsd.toFixed(2)),
    organicVolume24hUsd: Number(organicVolume24hUsd.toFixed(2)),
    liquidityUsd: Number(liquidityUsd.toFixed(2)),
    deepestPoolUsd: Number(deepestPoolUsd.toFixed(2)),
    deepLiquidity:
      liquidityUsd >= DEEP_LIQUIDITY_USD && deepestPoolUsd >= MIN_DEEPEST_POOL_USD,
    marketCapUsd: Number(marketCapUsd.toFixed(2)),
    fdvUsd: Number(fdvUsd.toFixed(2)),
    washSuspected,
    hasMarket: organicVolume24hUsd >= MIN_ORGANIC_VOLUME_USD,
  };
}

/** Whether a contract is traded enough to matter, when the answer is known. */
export function isThinMarket(
  signals: Pick<MarketSignals, "organicVolume24hUsd"> | undefined,
  minVolumeUsd = MIN_ORGANIC_VOLUME_USD,
): boolean {
  if (!signals) return false; // unknown is never a reason to hide
  return signals.organicVolume24hUsd < minVolumeUsd;
}

/**
 * True when a token's pools hold too little money to call it real. `undefined`
 * (no answer) is never shallow — missing data must not hide a holding.
 */
export function isShallowLiquidity(
  signals: Pick<MarketSignals, "liquidityUsd"> | undefined,
  minLiquidityUsd = MIN_LIQUIDITY_USD,
): boolean {
  if (!signals) return false;
  return signals.liquidityUsd < minLiquidityUsd;
}

/** `deep` / `shallow` / `unknown` — the depth verdict for one contract. */
export type LiquidityDepth = "deep" | "shallow" | "unknown";

export function liquidityDepth(
  signals: Pick<MarketSignals, "liquidityUsd" | "deepLiquidity"> | undefined,
): LiquidityDepth {
  if (!signals) return "unknown";
  if (signals.deepLiquidity) return "deep";
  return isShallowLiquidity(signals) ? "shallow" : "unknown";
}

/**
 * Looks up market signals for up to 30 contracts per call. Best-effort: a failed
 * or slow batch leaves those contracts out of the map, which callers read as
 * "unknown" and treat as "keep".
 */
export async function fetchMarketSignals(
  contracts: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, MarketSignals>> {
  const unique = [...new Set(contracts.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, MarketSignals>();
  if (unique.length === 0) return out;

  for (let index = 0; index < unique.length; index += DEXSCREENER_BATCH_SIZE) {
    const batch = unique.slice(index, index + DEXSCREENER_BATCH_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${DEXSCREENER_TOKENS_URL}/${batch.join(",")}`, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "Ledgerly/1.0" },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const data = (await response.json()) as unknown;
      const pairs = record(data)?.pairs;
      if (!Array.isArray(pairs)) continue;
      for (const contract of batch) {
        out.set(contract, signalsFromPairs(pairs, contract));
      }
    } catch {
      // Timeouts, rate limits and DNS failures all mean "unknown", not "junk".
    } finally {
      clearTimeout(timer);
    }
  }

  return out;
}

/** `$12.3k` — compact money for a badge. */
export function shortUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export const EMPTY_MARKET_SIGNALS = EMPTY;
