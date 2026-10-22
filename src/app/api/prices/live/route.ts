import { NextResponse } from "next/server";
import { fetchMarketPrice, PRICE_PROVIDERS, type PriceProvider } from "@/lib/market-prices";
import { fetchStockQuote } from "@/lib/stock-prices";

export const dynamic = "force-dynamic";

type RequestBody = {
  provider?: string;
  quote?: string;
  assets?: Array<{ id?: number; symbol?: string; type?: string }>;
};

/**
 * POST /api/prices/live
 *
 * Fills in the "New price" column on /prices. Crypto symbols use the selected
 * public exchange; stock symbols use Yahoo Finance. The two are independent, so
 * a bad stock symbol never stops the crypto prices from loading.
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
    assets.map(async ({ id, symbol, type }) => {
      if (!Number.isInteger(id) || !symbol || !symbol.trim()) return { id, error: "Missing symbol" };
      try {
        const price =
          type === "stock"
            ? (await fetchStockQuote(symbol)).price
            : await fetchMarketPrice(provider, symbol, quote);
        return { id, price };
      } catch (error) {
        return { id, error: error instanceof Error ? error.message : "Price unavailable" };
      }
    }),
  );

  const found = results.filter((result) => "price" in result).length;
  return NextResponse.json({ provider: body.provider, quote, found, results });
}
