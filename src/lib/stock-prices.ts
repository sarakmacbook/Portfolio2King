/**
 * Stock quotes from Yahoo Finance.
 *
 * Yahoo's public chart endpoint needs no API key, which matches how the crypto
 * providers work: the app only ever reads public market data. It is an
 * unofficial API, so the parser is defensive and every failure maps to a short,
 * user-facing message.
 *
 * The app reports in USD, so a quote in another currency is converted with
 * Yahoo's own FX pair. A conversion that cannot be priced fails loudly instead
 * of storing a number that is wrong by a factor of 100 (pence vs pounds).
 */

const CHART_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"] as const;
const REQUEST_TIMEOUT_MS = 8000;
/** Yahoo dislikes unknown clients; a normal browser-style UA is the reliable choice. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; Portfolio/1.0; +https://github.com/sarakmacbook/Portfolio2King)";
/** Space requests out: a portfolio of 30 stocks is 30 calls, and Yahoo rate-limits bursts. */
const MIN_GAP_MS = 120;
const FX_CACHE_MS = 10 * 60_000;

/** Currencies quoted in minor units, and the major currency they belong to. */
const MINOR_UNITS: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  GBX: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

export type StockQuote = {
  symbol: string;
  /** Price in USD, ready to store on the asset. */
  price: number;
  /** Currency Yahoo quoted in, before conversion (e.g. "USD", "GBp"). */
  currency: string;
  exchange: string;
  asOf: Date | null;
};

export type ParsedChart = {
  symbol: string;
  price: number;
  currency: string;
  exchange: string;
  asOf: Date | null;
};

/**
 * Yahoo resolves `BRK-B` but not `BRK.B`, while Tokyo listings need the dot
 * (`7203.T`). Rather than rewrite dots, try the symbol as typed and fall back to
 * the dashed form only if Yahoo cannot find it.
 */
export function stockSymbolCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  // Inner whitespace is a typo, not something to silently strip.
  if (!trimmed || /\s/.test(trimmed)) return [];
  const symbol = trimmed.toUpperCase().replace(/^\$/, "");
  // Letters, digits and the separators Yahoo uses (indices start with ^).
  if (!/^\^?[A-Z0-9][A-Z0-9.\-=]{0,19}$/.test(symbol)) return [];
  const dashed = symbol.replace(/\./g, "-");
  return dashed === symbol ? [symbol] : [symbol, dashed];
}

export function isValidStockSymbol(raw: string): boolean {
  return stockSymbolCandidates(raw).length > 0;
}

function asNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Last non-null close, used when `meta.regularMarketPrice` is absent. */
function lastClose(quote: any): number | null {
  const closes = quote?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return null;
  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const value = asNumber(closes[index]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Reads one `v8/finance/chart` payload. Throws with a readable message for
 * Yahoo's own error object (`{ chart: { error: { description } } }`).
 */
export function parseYahooChart(payload: unknown): ParsedChart {
  const chart = (payload as any)?.chart;
  const error = chart?.error;
  if (error) {
    const description = String(error.description ?? error.code ?? "").trim();
    throw new Error(description || "Yahoo Finance could not price that symbol");
  }

  const result = Array.isArray(chart?.result) ? chart.result[0] : null;
  if (!result) throw new Error("Yahoo Finance returned no price for that symbol");

  const meta = result.meta ?? {};
  const price = asNumber(meta.regularMarketPrice) ?? lastClose(result);
  if (price === null) throw new Error("Yahoo Finance returned no price for that symbol");

  const marketTime = Number(meta.regularMarketTime);
  return {
    symbol: String(meta.symbol ?? "").toUpperCase(),
    price,
    currency: String(meta.currency ?? "USD"),
    exchange: String(meta.fullExchangeName ?? meta.exchangeName ?? ""),
    asOf: Number.isFinite(marketTime) && marketTime > 0 ? new Date(marketTime * 1000) : null,
  };
}

/**
 * Converts a quote to USD. `rate` is the price of one major unit in USD (e.g.
 * 1.09 for EUR). Throws when the currency has no rate, so a wrong number is
 * never stored silently.
 */
export function quoteToUsd(price: number, currency: string, rate: number | null): number {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Yahoo Finance returned no price for that symbol");
  const minor = MINOR_UNITS[currency];
  const major = minor?.major ?? currency;
  const divisor = minor?.divisor ?? 1;

  // Six decimals is plenty for a unit price and keeps float noise out of the
  // stored value (109.00000000000001).
  const round = (value: number) => Math.round(value * 1e6) / 1e6;

  if (major.toUpperCase() === "USD") {
    const value = round(price / divisor);
    return Number.isFinite(value) && value > 0 ? value : price;
  }
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Priced in ${currency}; no USD exchange rate was available. Enter the price manually.`);
  }
  return round((price / divisor) * rate);
}

/** Yahoo quotes `GBp`/`ZAc`/`ILA` in minor units; the FX pair uses the major one. */
export function majorCurrency(currency: string): string {
  return MINOR_UNITS[currency]?.major ?? currency.toUpperCase();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type CacheEntry = { rate: number; at: number };
const fxCache = new Map<string, CacheEntry>();

/** Serialises Yahoo calls with a small gap so a refresh does not trip the rate limit. */
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  requestQueue = run.catch(() => undefined);
  return run as Promise<T>;
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.ok) return response.json();
  if (response.status === 404) throw new Error("Symbol not found on Yahoo Finance");
  if (response.status === 429) throw new Error("Yahoo Finance rate limit reached — try again in a minute");
  if (response.status === 401 || response.status === 403) throw new Error("Yahoo Finance refused the request");
  throw new Error(`Yahoo Finance returned ${response.status}`);
}

/** One chart request, retried on the second host if the first fails. */
async function fetchChart(symbol: string): Promise<any> {
  const query = `interval=1d&range=1d&includePrePost=false`;
  let lastError: Error | null = null;
  for (const host of CHART_HOSTS) {
    try {
      // `=` and `^` are meaningful in Yahoo symbols (FX pairs, indices) and are
      // accepted unencoded.
      const encoded = encodeURIComponent(symbol).replace(/%3D/g, "=").replace(/%5E/g, "^");
      return await getJson(`${host}/v8/finance/chart/${encoded}?${query}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Yahoo Finance is unreachable");
      // A missing symbol is not a host problem — do not retry it.
      if (/not found/i.test(lastError.message)) break;
    }
  }
  throw lastError ?? new Error("Yahoo Finance is unreachable");
}

async function fetchFxRate(currency: string): Promise<number | null> {
  const major = majorCurrency(currency);
  if (major === "USD") return 1;

  const cached = fxCache.get(major);
  if (cached && Date.now() - cached.at < FX_CACHE_MS) return cached.rate;

  const pairs = [`${major}USD=X`, `USD${major}=X`];
  for (const [index, pair] of pairs.entries()) {
    try {
      const chart = parseYahooChart(await fetchChart(pair));
      // The second form is quoted the other way round, so invert it.
      const rate = index === 0 ? chart.price : 1 / chart.price;
      if (Number.isFinite(rate) && rate > 0) {
        fxCache.set(major, { rate, at: Date.now() });
        return rate;
      }
    } catch {
      // Try the inverted pair, then give up and report it to the caller.
    }
  }
  return null;
}

/** Resets the FX cache — used by tests. */
export function clearFxCache() {
  fxCache.clear();
}

/**
 * Latest price for one stock or ETF symbol, in USD.
 * `allowConversion: false` keeps the raw quote currency (used by the FX lookup).
 */
export async function fetchStockQuote(rawSymbol: string): Promise<StockQuote> {
  const candidates = stockSymbolCandidates(rawSymbol);
  if (candidates.length === 0) {
    throw new Error("Use a stock symbol such as AAPL or 7203.T");
  }

  let lastError: Error | null = null;
  for (const symbol of candidates) {
    try {
      const chart = await schedule(() => fetchChart(symbol));
      const parsed = parseYahooChart(chart);
      const rate = await schedule(() => fetchFxRate(parsed.currency));
      return {
        symbol: parsed.symbol || symbol,
        price: quoteToUsd(parsed.price, parsed.currency, rate),
        currency: parsed.currency,
        exchange: parsed.exchange,
        asOf: parsed.asOf,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Yahoo Finance is unreachable");
      // Only fall through to the dashed form when the symbol itself is unknown.
      if (!/not found/i.test(lastError.message)) break;
    }
  }
  throw lastError ?? new Error("Yahoo Finance is unreachable");
}

/** Currency note for the UI, e.g. "quoted in GBp, converted to USD". */
export function currencyNote(quote: StockQuote): string {
  if (majorCurrency(quote.currency) === "USD") return "USD";
  return `${quote.currency} → USD`;
}
