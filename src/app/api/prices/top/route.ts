import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Coin = { id?: unknown; name?: unknown; symbol?: unknown; current_price?: unknown; market_cap_rank?: unknown };

export async function GET() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&sparkline=false",
      {
        headers: { Accept: "application/json", "User-Agent": "Ledgerly/1.0" },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error(`Market API returned ${response.status}`);
    const data = (await response.json()) as Coin[];
    const assets = data
      .filter((coin) => typeof coin.name === "string" && typeof coin.symbol === "string" && Number(coin.current_price) > 0)
      .map((coin) => ({
        id: String(coin.id),
        name: String(coin.name),
        symbol: String(coin.symbol).toUpperCase(),
        price: Number(coin.current_price),
        rank: Number(coin.market_cap_rank) || null,
      }));
    return NextResponse.json({ assets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load top crypto assets" },
      { status: 502 },
    );
  }
}
