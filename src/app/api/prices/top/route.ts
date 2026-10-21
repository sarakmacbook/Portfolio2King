import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type MarketCoin = { id?: unknown; name?: unknown; symbol?: unknown; current_price?: unknown; market_cap_rank?: unknown };
type SearchCoin = { id?: unknown };
type DexPair = {
  chainId?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown };
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
};

const headers = { Accept: "application/json", "User-Agent": "Ledgerly/1.0" };

async function getJson(url: string, revalidate = 60) {
  const response = await fetch(url, { headers, next: { revalidate }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Market API returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

function normaliseMarkets(data: unknown) {
  if (!Array.isArray(data)) return [];
  return (data as MarketCoin[])
    .filter((coin) => typeof coin.id === "string" && typeof coin.name === "string" && typeof coin.symbol === "string" && Number(coin.current_price) > 0)
    .map((coin) => ({
      id: String(coin.id),
      name: String(coin.name),
      symbol: String(coin.symbol).toUpperCase(),
      price: Number(coin.current_price),
      rank: Number(coin.market_cap_rank) || null,
      chain: null as string | null,
      contract: null as string | null,
    }));
}

function looksLikeContract(query: string) {
  return (/^0x[a-fA-F0-9]{40}$/.test(query) || /^[1-9A-HJ-NP-Za-km-z]{32,60}$/.test(query));
}

async function searchContract(contract: string) {
  const data = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(contract)}`, 30) as { pairs?: DexPair[] };
  const exact = (Array.isArray(data.pairs) ? data.pairs : [])
    .filter((pair) => String(pair.baseToken?.address || "").toLowerCase() === contract.toLowerCase() && Number(pair.priceUsd) > 0)
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  const pair = exact[0];
  if (!pair) return [];
  return [{
    id: `${String(pair.chainId || "chain")}:${contract}`,
    name: String(pair.baseToken?.name || pair.baseToken?.symbol || "Unknown token"),
    symbol: String(pair.baseToken?.symbol || "TOKEN").toUpperCase(),
    price: Number(pair.priceUsd),
    rank: null,
    chain: String(pair.chainId || "Unknown chain"),
    contract,
  }];
}

async function searchCoins(query: string) {
  const result = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`) as { coins?: SearchCoin[] };
  const ids = (Array.isArray(result.coins) ? result.coins : [])
    .map((coin) => typeof coin.id === "string" ? coin.id : "")
    .filter(Boolean)
    .slice(0, 20);
  if (!ids.length) return [];
  const markets = await getJson(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&order=market_cap_desc&sparkline=false`,
  );
  return normaliseMarkets(markets);
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    const assets = query
      ? looksLikeContract(query) ? await searchContract(query) : await searchCoins(query)
      : normaliseMarkets(await getJson(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&sparkline=false",
          300,
        ));
    return NextResponse.json({ assets, query });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not search crypto assets" },
      { status: 502 },
    );
  }
}
