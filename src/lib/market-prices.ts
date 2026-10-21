export const PRICE_PROVIDERS = ["bybit", "okx", "binance", "coinbase", "kraken", "dexscreener"] as const;
export type PriceProvider = (typeof PRICE_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<PriceProvider, string> = {
  bybit: "Bybit",
  okx: "OKX",
  binance: "Binance",
  coinbase: "Coinbase Exchange",
  kraken: "Kraken",
  dexscreener: "DexScreener (DEX)",
};

function baseSymbol(value: string) {
  return value.trim().toUpperCase().split(/[\/-]/)[0].replace(/[^A-Z0-9]/g, "");
}

async function getJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Ledgerly/1.0" },
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
  if (!symbol) throw new Error("Asset has no valid symbol");

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
