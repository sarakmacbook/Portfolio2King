/**
 * Crypto asset search with provider fallback.
 *
 * CoinGecko’s public search is rate-limited aggressively (HTTP 429). When that
 * happens — or when any provider errors out — the next provider is tried:
 *
 *   search: CoinGecko → CoinPaprika → DexScreener
 *   top:    CoinGecko → CoinPaprika → Binance
 *
 * Results are cached briefly in-process so repeated searches do not spend the
 * providers’ quotas, and a provider that reports a rate limit is skipped for a
 * short cooldown window.
 */

export type CryptoSearchProvider = "coingecko" | "coinpaprika" | "dexscreener" | "binance";

export type CryptoSearchAsset = {
  id: string;
  name: string;
  symbol: string;
  price: number;
  rank: number | null;
  chain: string | null;
  contract: string | null;
};

export type CryptoSearchResponse = {
  assets: CryptoSearchAsset[];
  source: CryptoSearchProvider;
};

export class CryptoSearchError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "CryptoSearchError";
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 4_500;
const LONG_REQUEST_TIMEOUT_MS = 10_000;
const SEARCH_CACHE_TTL_MS = 60_000;
const TOP_CACHE_TTL_MS = 300_000;
const PROVIDER_COOLDOWN_MS = 60_000;
const MAX_PROVIDER_COOLDOWN_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const RESULT_LIMIT = 12;
const TOP_LIMIT = 12;

const HEADERS = { Accept: "application/json", "User-Agent": "Portfolio/1.0" };

class ProviderError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

type CacheEntry = {
  assets: CryptoSearchAsset[];
  source: CryptoSearchProvider;
  expires: number;
};

type CryptoSearchState = {
  cache: Map<string, CacheEntry>;
  cooldowns: Map<string, number>;
};

type ProviderAttempt = {
  provider: CryptoSearchProvider;
  run: () => Promise<CryptoSearchAsset[]>;
};

const globalForSearch = globalThis as typeof globalThis & {
  __ledgerlyCryptoSearch?: CryptoSearchState;
};

function getState(): CryptoSearchState {
  globalForSearch.__ledgerlyCryptoSearch ??= { cache: new Map(), cooldowns: new Map() };
  return globalForSearch.__ledgerlyCryptoSearch;
}

/** Clears the in-process cache and provider cooldowns (used by tests). */
export function resetCryptoSearchState() {
  globalForSearch.__ledgerlyCryptoSearch = { cache: new Map(), cooldowns: new Map() };
}

function readCache(key: string): CacheEntry | null {
  const state = getState();
  const entry = state.cache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    state.cache.delete(key);
    return null;
  }
  return entry;
}

function writeCache(key: string, assets: CryptoSearchAsset[], source: CryptoSearchProvider, ttlMs: number) {
  const state = getState();
  state.cache.set(key, { assets, source, expires: Date.now() + ttlMs });
  if (state.cache.size > MAX_CACHE_ENTRIES) {
    const oldest = state.cache.keys().next().value;
    if (oldest) state.cache.delete(oldest);
  }
}

function isCoolingDown(provider: CryptoSearchProvider) {
  return (getState().cooldowns.get(provider) ?? 0) > Date.now();
}

function markRateLimited(provider: CryptoSearchProvider, retryAfterMs?: number) {
  const delay = Math.min(Math.max(retryAfterMs ?? PROVIDER_COOLDOWN_MS, 5_000), MAX_PROVIDER_COOLDOWN_MS);
  getState().cooldowns.set(provider, Date.now() + delay);
}

function isRateLimit(error: unknown): error is ProviderError {
  // 402 is CoinPaprika’s plan-limit response and 418 is Binance’s IP ban.
  return error instanceof ProviderError && (error.status === 429 || error.status === 402 || error.status === 418);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

async function getJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderError(0, "Crypto data provider is unreachable");
  }
  if (!response.ok) {
    throw new ProviderError(
      response.status,
      `Crypto data provider returned ${response.status}`,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError(0, "Crypto data provider returned invalid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveRank(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normaliseCoinGeckoMarkets(data: unknown): CryptoSearchAsset[] {
  if (!Array.isArray(data)) return [];
  const assets: CryptoSearchAsset[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const id = text(item.id);
    const name = text(item.name);
    const symbol = text(item.symbol);
    const price = positiveNumber(item.current_price);
    if (!id || !name || !symbol || price === null) continue;
    assets.push({
      id,
      name,
      symbol: symbol.toUpperCase(),
      price,
      rank: positiveRank(item.market_cap_rank),
      chain: null,
      contract: null,
    });
  }
  return assets;
}

async function coinGeckoSearch(query: string): Promise<CryptoSearchAsset[]> {
  const result = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  const coins = isRecord(result) && Array.isArray(result.coins) ? result.coins : [];
  const ids: string[] = [];
  for (const coin of coins) {
    if (!isRecord(coin)) continue;
    const id = text(coin.id);
    if (id) ids.push(id);
    if (ids.length >= 10) break;
  }
  if (!ids.length) return [];

  const markets = await getJson(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&order=market_cap_desc&sparkline=false`,
  );
  return normaliseCoinGeckoMarkets(markets).slice(0, RESULT_LIMIT);
}

async function coinGeckoTop(): Promise<CryptoSearchAsset[]> {
  const data = await getJson(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&sparkline=false",
  );
  return normaliseCoinGeckoMarkets(data).slice(0, TOP_LIMIT);
}

function coinPaprikaQuotePrice(item: Record<string, unknown>): number | null {
  const quotes = isRecord(item.quotes) ? item.quotes : null;
  const usd = quotes && isRecord(quotes.USD) ? quotes.USD : null;
  return usd ? positiveNumber(usd.price) : null;
}

async function coinPaprikaSearch(query: string): Promise<CryptoSearchAsset[]> {
  const result = await getJson(
    `https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(query)}&c=currencies&limit=10`,
  );
  const currencies = isRecord(result) && Array.isArray(result.currencies) ? result.currencies : [];

  const coins: Array<{ id: string; name: string; symbol: string; rank: number | null }> = [];
  for (const item of currencies) {
    if (!isRecord(item) || item.is_active === false) continue;
    const id = text(item.id);
    const name = text(item.name);
    const symbol = text(item.symbol);
    if (!id || !name || !symbol) continue;
    coins.push({ id, name, symbol, rank: positiveRank(item.rank) });
    if (coins.length >= 4) break;
  }
  if (!coins.length) return [];

  // Search returns names/symbols only; prices come from one ticker per match.
  const settled = await Promise.allSettled(
    coins.map(async (coin): Promise<CryptoSearchAsset | null> => {
      const ticker = await getJson(
        `https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(coin.id)}?quotes=USD`,
      );
      if (!isRecord(ticker)) return null;
      const price = coinPaprikaQuotePrice(ticker);
      if (price === null) return null;
      return {
        id: coin.id,
        name: text(ticker.name) || coin.name,
        symbol: (text(ticker.symbol) || coin.symbol).toUpperCase(),
        price,
        rank: positiveRank(ticker.rank) ?? coin.rank,
        chain: null,
        contract: null,
      };
    }),
  );

  const assets = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  if (!assets.length) {
    const limited = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected" && isRateLimit(result.reason),
    );
    if (limited) throw limited.reason;
  }
  return assets;
}

async function coinPaprikaTop(): Promise<CryptoSearchAsset[]> {
  const data = await getJson("https://api.coinpaprika.com/v1/tickers?quotes=USD", LONG_REQUEST_TIMEOUT_MS);
  if (!Array.isArray(data)) return [];

  const assets: CryptoSearchAsset[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const id = text(item.id);
    const name = text(item.name);
    const symbol = text(item.symbol);
    const price = coinPaprikaQuotePrice(item);
    const rank = positiveRank(item.rank);
    if (!id || !name || !symbol || price === null || rank === null) continue;
    assets.push({
      id,
      name,
      symbol: symbol.toUpperCase(),
      price,
      rank,
      chain: null,
      contract: null,
    });
  }
  return assets.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).slice(0, TOP_LIMIT);
}

function pairLiquidity(pair: unknown): number {
  if (!isRecord(pair) || !isRecord(pair.liquidity)) return 0;
  return Number(pair.liquidity.usd) || 0;
}

function dexPairToAsset(pair: unknown): CryptoSearchAsset | null {
  if (!isRecord(pair) || !isRecord(pair.baseToken)) return null;
  const contract = text(pair.baseToken.address);
  const symbol = text(pair.baseToken.symbol);
  const price = positiveNumber(pair.priceUsd);
  const chain = text(pair.chainId);
  if (!contract || !symbol || price === null) return null;
  return {
    id: `${chain || "chain"}:${contract}`,
    name: text(pair.baseToken.name) || symbol,
    symbol: symbol.toUpperCase(),
    price,
    rank: null,
    chain: chain || null,
    contract,
  };
}

/**
 * Turns DEX pairs into assets, preferring pairs whose symbol/name matches the
 * query, then the deepest liquidity. DEX search is symbol-based and noisy, so
 * relevance matters more than raw volume here.
 */
function assetsFromPairs(pairs: unknown[], query = ""): CryptoSearchAsset[] {
  const term = query.trim().toUpperCase();
  const relevance = (asset: CryptoSearchAsset) => {
    if (!term) return 0;
    if (asset.symbol === term) return 2;
    if (asset.name.toUpperCase().includes(term) || term.includes(asset.symbol)) return 1;
    return 0;
  };

  const candidates = pairs.flatMap((pair) => {
    const asset = dexPairToAsset(pair);
    return asset ? [{ asset, score: relevance(asset), liquidity: pairLiquidity(pair) }] : [];
  });
  const hasRelevantMatch = candidates.some((candidate) => candidate.score > 0);
  const ordered = candidates
    .filter((candidate) => !hasRelevantMatch || candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.liquidity - a.liquidity);

  const seen = new Set<string>();
  const assets: CryptoSearchAsset[] = [];
  for (const { asset } of ordered) {
    const key = `${asset.chain ?? ""}:${asset.contract?.toLowerCase() ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assets.push(asset);
    if (assets.length >= RESULT_LIMIT) break;
  }
  return assets;
}

async function dexScreenerSearch(query: string): Promise<CryptoSearchAsset[]> {
  const data = await getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  const pairs = isRecord(data) && Array.isArray(data.pairs) ? data.pairs : [];
  return assetsFromPairs(pairs, query);
}

async function dexScreenerContract(contract: string): Promise<CryptoSearchAsset[]> {
  const data = await getJson(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(contract)}`,
  );
  const pairs = isRecord(data) && Array.isArray(data.pairs) ? data.pairs : [];
  const exact = pairs.filter((pair) => {
    if (!isRecord(pair) || !isRecord(pair.baseToken)) return false;
    return text(pair.baseToken.address).toLowerCase() === contract.toLowerCase();
  });
  return assetsFromPairs(exact).slice(0, 1);
}

const STABLE_BASES = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "USDD", "PYUSD", "FRAX",
  "USDE", "USD1", "EUR", "EURI", "AEUR", "GBP", "TRY", "BRL", "ARS", "ZAR", "AUD",
  "JPY", "RUB", "UAH", "NGN", "IDRT", "BIDR", "PLN", "RON",
]);

async function binanceTop(): Promise<CryptoSearchAsset[]> {
  const data = await getJson("https://api.binance.com/api/v3/ticker/24hr", LONG_REQUEST_TIMEOUT_MS);
  if (!Array.isArray(data)) return [];

  const ranked: Array<{ asset: CryptoSearchAsset; volume: number }> = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const pair = text(item.symbol).toUpperCase();
    if (!pair.endsWith("USDT")) continue;
    const base = pair.slice(0, -4);
    if (!base || STABLE_BASES.has(base)) continue;
    const price = positiveNumber(item.lastPrice);
    const volume = Number(item.quoteVolume);
    if (price === null || !Number.isFinite(volume) || volume <= 0) continue;
    ranked.push({
      asset: {
        id: `binance:${base}`,
        name: base,
        symbol: base,
        price,
        rank: null,
        chain: null,
        contract: null,
      },
      volume,
    });
  }

  return ranked
    .sort((a, b) => b.volume - a.volume)
    .slice(0, TOP_LIMIT)
    .map((row) => row.asset);
}

function looksLikeContract(query: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(query) || /^[1-9A-HJ-NP-Za-km-z]{32,60}$/.test(query);
}

async function attemptProviders(
  attempts: ProviderAttempt[],
  cacheKey: string,
  ttlMs: number,
): Promise<CryptoSearchResponse> {
  const cached = readCache(cacheKey);
  if (cached) return { assets: cached.assets, source: cached.source };

  let answered: CryptoSearchProvider | null = null;
  let limited = 0;

  for (const attempt of attempts) {
    if (isCoolingDown(attempt.provider)) {
      limited += 1;
      continue;
    }

    try {
      const assets = await attempt.run();
      getState().cooldowns.delete(attempt.provider);
      if (assets.length) {
        writeCache(cacheKey, assets, attempt.provider, ttlMs);
        return { assets, source: attempt.provider };
      }
      // A reachable provider with no matches: keep trying other indexes.
      answered ??= attempt.provider;
    } catch (error) {
      if (isRateLimit(error)) {
        limited += 1;
        markRateLimited(attempt.provider, error.retryAfterMs);
      }
    }
  }

  // At least one provider answered but nothing matched the query.
  if (answered) return { assets: [], source: answered };
  if (limited === attempts.length) {
    throw new CryptoSearchError(
      "Crypto price providers are rate-limited right now. Try again in a minute.",
      429,
    );
  }
  throw new CryptoSearchError("Could not reach a crypto data provider. Try again shortly.", 502);
}

/** Searches by name, symbol, or token contract address; falls back across providers. */
export async function searchCryptoAssets(query: string): Promise<CryptoSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return getTopCryptoAssets();

  if (looksLikeContract(trimmed)) {
    return attemptProviders(
      [{ provider: "dexscreener", run: () => dexScreenerContract(trimmed) }],
      `contract:${trimmed.toLowerCase()}`,
      SEARCH_CACHE_TTL_MS,
    );
  }

  return attemptProviders(
    [
      { provider: "coingecko", run: () => coinGeckoSearch(trimmed) },
      { provider: "coinpaprika", run: () => coinPaprikaSearch(trimmed) },
      { provider: "dexscreener", run: () => dexScreenerSearch(trimmed) },
    ],
    `search:${trimmed.toLowerCase()}`,
    SEARCH_CACHE_TTL_MS,
  );
}

/** Returns the 12 largest assets, falling back across providers. */
export async function getTopCryptoAssets(): Promise<CryptoSearchResponse> {
  return attemptProviders(
    [
      { provider: "coingecko", run: coinGeckoTop },
      { provider: "coinpaprika", run: coinPaprikaTop },
      { provider: "binance", run: binanceTop },
    ],
    "top",
    TOP_CACHE_TTL_MS,
  );
}
