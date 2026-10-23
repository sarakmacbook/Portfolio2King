import { NextResponse } from "next/server";
import { fetchStockQuote } from "@/lib/stock-prices";
import {
  POPULAR_STOCKS,
  getTopStocks,
  searchStocks,
} from "@/lib/stock-search";

export const dynamic = "force-dynamic";

/**
 * Stock & ETF scanner for the "Add holding" dialog.
 *
 * GET /api/prices/stocks              → top stocks & ETFs
 * GET /api/prices/stocks?q=apple      → search stocks & ETFs by name or ticker
 * GET /api/prices/stocks?symbol=AAPL  → fetch a live USD quote for one symbol
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const singleSymbol = (params.get("symbol") ?? "").trim();

  if (singleSymbol) {
    try {
      const quote = await fetchStockQuote(singleSymbol);
      return NextResponse.json(
        {
          symbol: quote.symbol,
          price: quote.price,
          currency: quote.currency,
          exchange: quote.exchange,
          source: "yahoo",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      const fallback = POPULAR_STOCKS.find(
        (item) => item.symbol.toUpperCase() === singleSymbol.toUpperCase().replace(/\./g, "-"),
      );
      if (fallback && fallback.price !== null) {
        return NextResponse.json(
          {
            symbol: fallback.symbol,
            price: fallback.price,
            currency: fallback.currency,
            exchange: fallback.exchange,
            source: "catalog",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not fetch a live stock quote",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const query = (params.get("q") ?? "").trim();
  try {
    const { assets, source } = query ? await searchStocks(query) : await getTopStocks();
    return NextResponse.json(
      { assets, query, source },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not scan stock assets",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
