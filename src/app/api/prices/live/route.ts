import { NextResponse } from "next/server";
import { fetchMarketPrice, fetchPreferredMarketPrice, parsePriceSource, isPriceProvider, PRICE_PROVIDERS, type PriceProvider } from "@/lib/market-prices";
import { fetchStockQuote } from "@/lib/stock-prices";
import { isRealtimeCryptoCategory } from "@/lib/stablecoins";

export const dynamic = "force-dynamic";

type RequestBody = {
  provider?: string;
  quote?: string;
  /** Optional fallback across exchanges, used by the dashboard live card. */
  fallback?: boolean;
  /** `provider` per asset overrides the request default (the exchange it was added from). */
  assets?: Array<{
    id?: number;
    symbol?: string;
    type?: string;
    provider?: string;
    /** Crypto category the page loaded the asset with; stablecoins are never fetched live. */
    cryptoCategory?: string;
  }>;
};

/**
 * POST /api/prices/live
 *
 * Fills in the "New price" column on /prices. Crypto symbols use the selected
 * public spot order book (best bid/ask midpoint); stock symbols use Yahoo
 * Finance. The two are independent, so
 * a bad stock symbol never stops the crypto prices from loading.
 *
 * Real-time changes apply to volatile crypto only: a stablecoin is returned
 * untouched (`stablecoin: true`, no price) without hitting the network — its
 * stored price is what the live views keep showing.
 */
export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const assets = Array.isArray(body.assets) ? body.assets.slice(0, 50) : [];
  if (!assets.length) return NextResponse.json({ error: "No assets to update" }, { status: 400 });

  const wantsCrypto = assets.some((asset) => asset.type !== "stock");
  if (wantsCrypto && !PRICE_PROVIDERS.includes(body.provider as PriceProvider)) {
    return NextResponse.json({ error: "Unsupported price source" }, { status: 400 });
  }
  const provider = body.provider as PriceProvider;
  const quote = body.quote === "USD" ? "USD" : "USDT";

  const results = await Promise.all(
    assets.map(async ({ id, symbol, type, provider: preferred, cryptoCategory }) => {
      if (!Number.isInteger(id) || !symbol || !symbol.trim()) return { id, error: "Missing symbol" };
      // The exchange stored on an asset wins over the page-level selector.
      const source = isPriceProvider(preferred) ? preferred : provider;
      try {
        if (type === "stock") return { id, price: (await fetchStockQuote(symbol)).price, provider: source };
        // Real-time changes apply to volatile crypto only: stablecoins are
        // pegged to the dollar, so their stored price is kept and no order book
        // is queried for them.
        if (!isRealtimeCryptoCategory(cryptoCategory)) return { id, stablecoin: true };
        if (body.fallback) {
          const result = await fetchPreferredMarketPrice(parsePriceSource(preferred), symbol, quote);
          return { id, price: result.price, provider: result.provider };
        }
        return { id, price: await fetchMarketPrice(source, symbol, quote), provider: source };
      } catch (error) {
        return { id, error: error instanceof Error ? error.message : "Price unavailable" };
      }
    }),
  );

  const found = results.filter((result) => "price" in result).length;
  return NextResponse.json({ provider: body.provider, quote, found, results });
}
