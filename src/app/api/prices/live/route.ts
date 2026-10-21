import { NextResponse } from "next/server";
import { fetchMarketPrice, PRICE_PROVIDERS, type PriceProvider } from "@/lib/market-prices";

export const dynamic = "force-dynamic";

type RequestBody = {
  provider?: string;
  quote?: string;
  assets?: Array<{ id?: number; symbol?: string }>;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!PRICE_PROVIDERS.includes(body.provider as PriceProvider)) {
    return NextResponse.json({ error: "Unsupported price source" }, { status: 400 });
  }
  const provider = body.provider as PriceProvider;
  const quote = body.quote === "USD" ? "USD" : "USDT";
  const assets = Array.isArray(body.assets) ? body.assets.slice(0, 50) : [];
  if (!assets.length) return NextResponse.json({ error: "No crypto assets to update" }, { status: 400 });

  const results = await Promise.all(
    assets.map(async ({ id, symbol }) => {
      if (!Number.isInteger(id) || !symbol) return { id, error: "Missing symbol" };
      try {
        const price = await fetchMarketPrice(provider, symbol, quote);
        return { id, price };
      } catch (error) {
        return { id, error: error instanceof Error ? error.message : "Price unavailable" };
      }
    }),
  );

  const found = results.filter((result) => "price" in result).length;
  return NextResponse.json({ provider, quote, found, results });
}
