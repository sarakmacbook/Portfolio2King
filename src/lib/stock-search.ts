import {
  fetchStockQuote,
  isValidStockSymbol,
  stockSymbolCandidates,
} from "@/lib/stock-prices";

export type StockAssetKind = "Stock" | "ETF" | "Index";

export type DiscoveredStock = {
  symbol: string;
  name: string;
  price: number | null;
  currency: string;
  exchange: string;
  kind: StockAssetKind;
};

export type StockSearchResult = {
  assets: DiscoveredStock[];
  source: "yahoo" | "catalog";
};

const SEARCH_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
] as const;

const REQUEST_TIMEOUT_MS = 6000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; Ledgerly/1.0; +https://github.com/sarakmacbook/Portfolio2King)";

/**
 * Curated directory of widely held global stocks and ETFs so users can browse
 * top stocks immediately and still scan common tickers/names when Yahoo's
 * search index is rate-limited or unreachable.
 */
export const POPULAR_STOCKS: DiscoveredStock[] = [
  { symbol: "AAPL", name: "Apple Inc.", price: 232.5, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "NVDA", name: "NVIDIA Corporation", price: 138.6, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "MSFT", name: "Microsoft Corporation", price: 428.9, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "GOOGL", name: "Alphabet Inc.", price: 182.4, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", price: 210.8, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "META", name: "Meta Platforms, Inc.", price: 592.0, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "TSLA", name: "Tesla, Inc.", price: 258.5, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "BRK-B", name: "Berkshire Hathaway Inc.", price: 454.2, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", price: 540.1, currency: "USD", exchange: "NYSEArca", kind: "ETF" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", price: 588.3, currency: "USD", exchange: "NYSEArca", kind: "ETF" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", price: 505.4, currency: "USD", exchange: "NASDAQ", kind: "ETF" },
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", price: 292.7, currency: "USD", exchange: "NYSEArca", kind: "ETF" },
  { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF", price: 28.9, currency: "USD", exchange: "NYSEArca", kind: "ETF" },
  { symbol: "AVGO", name: "Broadcom Inc.", price: 176.3, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing", price: 194.8, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc.", price: 152.6, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "NFLX", name: "Netflix, Inc.", price: 762.0, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", price: 234.1, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "V", name: "Visa Inc.", price: 308.4, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "MA", name: "Mastercard Incorporated", price: 516.2, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "COST", name: "Costco Wholesale Corporation", price: 918.5, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "WMT", name: "Walmart Inc.", price: 84.3, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "LLY", name: "Eli Lilly and Company", price: 892.0, currency: "USD", exchange: "NYSE", kind: "Stock" },
  { symbol: "COIN", name: "Coinbase Global, Inc.", price: 245.0, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "PLTR", name: "Palantir Technologies Inc.", price: 58.4, currency: "USD", exchange: "NASDAQ", kind: "Stock" },
  { symbol: "IBIT", name: "iShares Bitcoin Trust ETF", price: 48.2, currency: "USD", exchange: "NASDAQ", kind: "ETF" },
  { symbol: "GLD", name: "SPDR Gold Shares ETF", price: 252.8, currency: "USD", exchange: "NYSEArca", kind: "ETF" },
  { symbol: "7203.T", name: "Toyota Motor Corporation", price: 18.4, currency: "USD", exchange: "Tokyo", kind: "Stock" },
];

const CATALOG_BY_SYMBOL = new Map<string, DiscoveredStock>(
  POPULAR_STOCKS.map((item) => [item.symbol.toUpperCase(), item]),
);

function normalizeKind(rawType: unknown): StockAssetKind {
  const upper = String(rawType ?? "").trim().toUpperCase();
  if (upper === "ETF" || upper === "MUTUALFUND") return "ETF";
  if (upper === "INDEX") return "Index";
  return "Stock";
}

export function parseYahooSearchPayload(payload: unknown): DiscoveredStock[] {
  const quotes = Array.isArray((payload as { quotes?: unknown[] })?.quotes)
    ? ((payload as { quotes: unknown[] }).quotes as Array<Record<string, unknown>>)
    : [];

  const seen = new Set<string>();
  const out: DiscoveredStock[] = [];

  for (const row of quotes) {
    const rawSymbol = String(row?.symbol ?? "").trim().toUpperCase();
    if (!rawSymbol || !isValidStockSymbol(rawSymbol) || seen.has(rawSymbol)) {
      continue;
    }
    const quoteType = String(row?.quoteType ?? "").trim().toUpperCase();
    if (
      quoteType &&
      quoteType !== "EQUITY" &&
      quoteType !== "ETF" &&
      quoteType !== "INDEX" &&
      quoteType !== "MUTUALFUND"
    ) {
      continue;
    }
    seen.add(rawSymbol);
    const catalogMatch = CATALOG_BY_SYMBOL.get(rawSymbol);
    const name = String(
      row?.longname ?? row?.shortname ?? catalogMatch?.name ?? rawSymbol,
    ).trim();
    const exchange = String(
      row?.exchDisp ?? row?.exchange ?? catalogMatch?.exchange ?? "",
    ).trim();

    out.push({
      symbol: rawSymbol,
      name: name || rawSymbol,
      price: catalogMatch?.price ?? null,
      currency: "USD",
      exchange,
      kind: normalizeKind(quoteType || catalogMatch?.kind),
    });
    if (out.length >= 10) break;
  }

  return out;
}

export function matchCatalogStocks(query: string, limit = 12): DiscoveredStock[] {
  const q = query.trim().toLowerCase();
  if (!q) return POPULAR_STOCKS.slice(0, limit).map((item) => ({ ...item }));

  const normalizedTicker = q.toUpperCase().replace(/\./g, "-");
  const scored: Array<{ item: DiscoveredStock; score: number }> = [];

  for (const item of POPULAR_STOCKS) {
    const symLower = item.symbol.toLowerCase();
    const nameLower = item.name.toLowerCase();
    const exchLower = item.exchange.toLowerCase();
    const kindLower = item.kind.toLowerCase();

    let score = 0;
    if (item.symbol === normalizedTicker || symLower === q) score = 100;
    else if (symLower.startsWith(q)) score = 80;
    else if (nameLower.startsWith(q)) score = 70;
    else if (nameLower.includes(q) || symLower.includes(q)) score = 50;
    else if (exchLower.includes(q) || kindLower.includes(q)) score = 30;

    if (score > 0) {
      scored.push({ item: { ...item }, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol));
  return scored.slice(0, limit).map((entry) => entry.item);
}

async function fetchYahooSearch(query: string): Promise<DiscoveredStock[]> {
  let lastError: Error | null = null;
  for (const host of SEARCH_HOSTS) {
    try {
      const url = `${host}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Yahoo search returned ${response.status}`);
      }
      const json = await response.json();
      return parseYahooSearchPayload(json);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Yahoo search failed");
    }
  }
  throw lastError ?? new Error("Yahoo search failed");
}

async function enrichWithLiveQuotes(
  items: DiscoveredStock[],
  maxLiveLookups = 6,
): Promise<{ assets: DiscoveredStock[]; liveCount: number }> {
  let liveCount = 0;
  const enriched = await Promise.all(
    items.map(async (item, index) => {
      if (index >= maxLiveLookups) return item;
      try {
        const quote = await fetchStockQuote(item.symbol);
        liveCount += 1;
        return {
          ...item,
          symbol: quote.symbol || item.symbol,
          price: quote.price,
          currency: quote.currency || "USD",
          exchange: quote.exchange || item.exchange,
        };
      } catch {
        return item;
      }
    }),
  );
  return { assets: enriched, liveCount };
}

export async function getTopStocks(): Promise<StockSearchResult> {
  const base = POPULAR_STOCKS.slice(0, 12).map((item) => ({ ...item }));
  const { assets, liveCount } = await enrichWithLiveQuotes(base, 6);
  return {
    assets,
    source: liveCount > 0 ? "yahoo" : "catalog",
  };
}

export async function searchStocks(rawQuery: string): Promise<StockSearchResult> {
  const query = rawQuery.trim();
  if (!query) return getTopStocks();

  const catalogMatches = matchCatalogStocks(query, 10);
  let discovered: DiscoveredStock[] = [];
  let yahooAnswered = false;

  try {
    discovered = await fetchYahooSearch(query);
    if (discovered.length > 0) yahooAnswered = true;
  } catch {
    // Fall back to direct symbol lookup and built-in stock catalog.
  }

  // Merge catalog matches that were not already in the Yahoo search list.
  const seen = new Set(discovered.map((item) => item.symbol.toUpperCase()));
  for (const item of catalogMatches) {
    const key = item.symbol.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      discovered.push(item);
    }
  }

  // If the query itself is a valid stock ticker (e.g. "AAPL", "BRK.B", "7203.T")
  // and not yet in the list, probe it directly via fetchStockQuote.
  const candidates = stockSymbolCandidates(query);
  if (candidates.length > 0 && !candidates.some((c) => seen.has(c))) {
    try {
      const quote = await fetchStockQuote(query);
      yahooAnswered = true;
      const catalogEntry = CATALOG_BY_SYMBOL.get(quote.symbol.toUpperCase());
      discovered.unshift({
        symbol: quote.symbol,
        name: catalogEntry?.name ?? quote.symbol,
        price: quote.price,
        currency: quote.currency,
        exchange: quote.exchange,
        kind: catalogEntry?.kind ?? "Stock",
      });
    } catch {
      // Ignore if the typed query is not a live Yahoo ticker.
    }
  }

  const { assets, liveCount } = await enrichWithLiveQuotes(discovered.slice(0, 10), 5);
  return {
    assets,
    source: yahooAnswered || liveCount > 0 ? "yahoo" : "catalog",
  };
}
