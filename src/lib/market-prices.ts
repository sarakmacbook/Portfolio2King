export const PRICE_PROVIDERS = ["bybit", "okx", "binance", "coinbase", "kraken", "dexscreener"] as const;
export type PriceProvider = (typeof PRICE_PROVIDERS)[number];

/** Centralised exchanges with public spot tickers — what a crypto asset can be pinned to. */
export const CEX_PROVIDERS = ["bybit", "okx", "binance", "coinbase", "kraken"] as const;

export const PROVIDER_LABELS: Record<PriceProvider, string> = {
  bybit: "Bybit",
  okx: "OKX",
  binance: "Binance",
  coinbase: "Coinbase Exchange",
  kraken: "Kraken",
  dexscreener: "DexScreener (DEX)",
};

export function isPriceProvider(value: unknown): value is PriceProvider {
  return typeof value === "string" && (PRICE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The exchange stored on an asset. Blank means "no preference" — every provider
 * is tried, which is what assets created before this setting existed get.
 */
export function parsePriceSource(value: unknown): PriceProvider | "" {
  const normalised = String(value ?? "").trim().toLowerCase();
  return isPriceProvider(normalised) ? normalised : "";
}

/** Human wording for a stored source, e.g. "Binance" or "Auto (any exchange)". */
export function describePriceSource(value: unknown): string {
  const source = parsePriceSource(value);
  return source ? PROVIDER_LABELS[source] : "Auto (any exchange)";
}

/**
 * Providers to try for one asset, in order: the pinned exchange first, then the
 * others. A pinned exchange that does not list the symbol never blocks a refresh.
 */
export function providerOrder(preferred: PriceProvider | ""): PriceProvider[] {
  if (!preferred) return [...PRICE_PROVIDERS];
  return [preferred, ...PRICE_PROVIDERS.filter((provider) => provider !== preferred)];
}

function baseSymbol(value: string) {
  return value.trim().toUpperCase().split(/[\/-]/)[0].replace(/[^A-Z0-9]/g, "");
}

async function getJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Portfolio/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Exchange returned ${response.status}`);
  return response.json() as Promise<any>;
}

function validPrice(value: unknown) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) throw new Error("No valid market price returned");
  return price;
}

/** Read a public spot ticker. Private exchange keys are intentionally never required. */
export async function fetchMarketPrice(provider: PriceProvider, rawSymbol: string, quote: "USD" | "USDT") {
  const symbol = baseSymbol(rawSymbol);

  switch (provider) {
    case "bybit": {
      const data = await getJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}${quote === "USD" ? "USDT" : quote}`);
      return validPrice(data?.result?.list?.[0]?.lastPrice);
    }
    case "okx": {
      const data = await getJson(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-${quote === "USD" ? "USDT" : quote}`);
      return validPrice(data?.data?.[0]?.last);
    }
    case "binance": {
      const data = await getJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}${quote === "USD" ? "USDT" : quote}`);
      return validPrice(data?.price);
    }
    case "coinbase": {
      const data = await getJson(`https://api.exchange.coinbase.com/products/${symbol}-${quote === "USDT" ? "USDT" : "USD"}/ticker`);
      return validPrice(data?.price);
    }
    case "kraken": {
      const pair = `${symbol}${quote}`;
      const data = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
      const ticker = data?.result && Object.values(data.result)[0] as any;
      return validPrice(ticker?.c?.[0]);
    }
    case "dexscreener": {
      const data = await getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(`${symbol} ${quote}`)}`);
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      const matches = pairs
        .filter((pair: any) => pair?.baseToken?.symbol?.toUpperCase() === symbol && pair?.priceUsd)
        .sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
      return validPrice(matches[0]?.priceUsd);
    }
  }
}

/**
 * Best price for one asset, starting at the exchange stored on it.
 *
 * A pinned exchange is tried first, on its own, so the price really comes from
 * the market the user chose. If that exchange does not list the pair (or is
 * briefly down) the remaining providers are raced in parallel, so a stale
 * holding never blocks on six timeouts in a row. Assets without a preference
 * keep the old "fastest provider wins" behaviour. The provider that answered is
 * returned so screens can say where a price came from instead of guessing.
 */
export async function fetchPreferredMarketPrice(
  preferred: PriceProvider | "",
  rawSymbol: string,
  quote: "USD" | "USDT" = "USDT",
): Promise<{ price: number; provider: PriceProvider }> {
  const attempt = async (provider: PriceProvider) => ({
    provider,
    price: await fetchMarketPrice(provider, rawSymbol, quote),
  });
  // Promise.any rejects with an AggregateError; callers want one plain sentence.
  const unavailable = () => {
    const symbol = baseSymbol(rawSymbol) || "this symbol";
    return new Error(
      preferred
        ? `No exchange returned a price for ${symbol} — ${PROVIDER_LABELS[preferred]} was tried first`
        : `No exchange returned a price for ${symbol}`,
    );
  };

  if (!preferred) {
    try {
      return await Promise.any(PRICE_PROVIDERS.map(attempt));
    } catch {
      throw unavailable();
    }
  }

  try {
    return await attempt(preferred);
  } catch {
    // Pinned exchange has no such pair (or is down): fall back to the rest.
  }
  const others = PRICE_PROVIDERS.filter((provider) => provider !== preferred);
  try {
    return await Promise.any(others.map(attempt));
  } catch {
    throw unavailable();
  }
}
