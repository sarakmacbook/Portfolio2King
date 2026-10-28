import { NextResponse } from "next/server";
import {
  CEX_PROVIDERS,
  PROVIDER_LABELS,
  fetchMarketPrice,
  isPriceProvider,
  type PriceProvider,
} from "@/lib/market-prices";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices/quote?symbol=BTC&provider=binance&quote=USDT
 *
 * One live quote from the chosen public exchange. The bulk endpoint
 * (`/api/prices/live`) needs asset ids that a holding being created does not
 * have yet, so the Add asset dialog asks here instead. Centralized exchange
 * prices are best-bid/ask midpoints from public spot order books; no API key is
 * required or sent for public market data.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "").trim();
  const rawProvider = (params.get("provider") ?? "").trim().toLowerCase();
  const quote = params.get("quote") === "USD" ? "USD" : "USDT";

  if (!symbol) return NextResponse.json({ error: "Enter a symbol first" }, { status: 400 });
  if (symbol.length > 32) return NextResponse.json({ error: "That symbol is too long" }, { status: 400 });
  if (!isPriceProvider(rawProvider) || !(CEX_PROVIDERS as readonly string[]).includes(rawProvider)) {
    return NextResponse.json({ error: "Choose a supported exchange" }, { status: 400 });
  }

  const provider = rawProvider as PriceProvider;
  try {
    const price = await fetchMarketPrice(provider, symbol, quote);
    return NextResponse.json(
      { symbol: symbol.toUpperCase(), provider, providerLabel: PROVIDER_LABELS[provider], quote, price },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Node's raw "fetch failed" says nothing useful; name the exchange instead.
    const raw = error instanceof Error ? error.message : "";
    const message = raw && !/^(fetch failed|aborted|timeout)$/i.test(raw)
      ? raw
      : `${PROVIDER_LABELS[provider]} is unreachable from this server`;
    return NextResponse.json(
      { error: message, provider, providerLabel: PROVIDER_LABELS[provider] },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
