import { NextResponse } from "next/server";
import { CryptoSearchError, getTopCryptoAssets, searchCryptoAssets } from "@/lib/crypto-search";

export const dynamic = "force-dynamic";

/**
 * Crypto search for the “Add holding” dialog.
 *
 * GET /api/prices/top          → top assets by market cap
 * GET /api/prices/top?q=btc    → search by name / symbol
 * GET /api/prices/top?q=0x…    → look up a token contract (DEX pairs)
 *
 * Each request is served by the first provider that answers, so a rate limit or
 * outage on CoinGecko falls through to CoinPaprika, DexScreener, or Binance.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";

  try {
    const { assets, source } = query ? await searchCryptoAssets(query) : await getTopCryptoAssets();
    return NextResponse.json(
      { assets, query, source },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CryptoSearchError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Could not search crypto assets" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
