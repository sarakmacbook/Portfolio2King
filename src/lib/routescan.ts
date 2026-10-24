/**
 * Token discovery through Routescan.
 *
 * Blockscout covers the big chains, but plenty of chains have no public
 * Blockscout instance (BNB Chain, Avalanche, …) and an instance that rate-limits
 * answers nothing. Routescan runs Etherscan-compatible explorers for 100+ EVM
 * chains and — unlike Etherscan itself — its free tier needs **no API key**
 * (2 requests/second, 10k/day), so it is the second discovery source.
 *
 *   GET /v2/network/mainnet/evm/{chainId}/etherscan/api
 *       ?module=account&action=addresstokenbalance&address=0x…&page=1&offset=100
 *
 * Best effort like Blockscout: an unknown chain, a blocked host or an odd payload
 * simply contributes no tokens and the RPC read carries on.
 */
import {
  type DiscoveredToken,
  MAX_DISCOVERED_TOKENS,
  normaliseDiscoveredTokens,
  rawTokenQuantity,
  readTokenNumber,
  readTokenString,
} from "@/lib/discovered-tokens";

/** Numeric chain ids Routescan needs in the URL path. */
export const ROUTESCAN_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bsc: 56,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
  optimism: 10,
  avalanche: 43114,
  zksync: 324,
  linea: 59144,
  scroll: 534352,
  mantle: 5000,
  blast: 81457,
  fantom: 250,
  gnosis: 100,
  cronos: 25,
  celo: 42220,
  metis: 1088,
  manta: 169,
  mode: 34443,
  taiko: 167000,
  kaia: 8217,
  merlin: 4200,
  core: 1116,
  zora: 7777777,
  opbnb: 204,
  nova: 42170,
  aurora: 1313161554,
  boba: 288,
  kava: 2222,
  astar: 592,
  ronin: 2020,
  sei: 1329,
  zetachain: 7000,
  moonbeam: 1284,
  moonriver: 1285,
  "polygon-zkevm": 1101,
  pulsechain: 369,
  fraxtal: 252,
  lisk: 1135,
  berachain: 80094,
  unichain: 130,
  ink: 57073,
  soneium: 1868,
  world: 480,
  ape: 33139,
  corn: 21000000,
  hyperevm: 999,
  sonic: 146,
  heco: 128,
  xdc: 50,
  canto: 7700,
  bob: 60808,
  cyber: 7560,
  mint: 185,
  shibarium: 109,
  immutable: 13371,
};

export const ROUTESCAN_TIMEOUT_MS = 8000;

/** Routescan caps `offset` at 100, so at most two pages are read. */
export const ROUTESCAN_PAGE_SIZE = 100;
export const ROUTESCAN_MAX_PAGES = 2;

export function routescanChainId(chain: string): number | null {
  const key = chain.trim().toLowerCase();
  return ROUTESCAN_CHAIN_IDS[key] ?? null;
}

export function routescanAccountUrl(chain: string, query: string): string | null {
  const id = routescanChainId(chain);
  if (!id) return null;
  return `https://api.routescan.io/v2/network/mainnet/evm/${id}/etherscan/api?${query}`;
}

export function routescanTokenBalanceUrl(
  chain: string,
  address: string,
  page = 1,
  offset = ROUTESCAN_PAGE_SIZE,
): string | null {
  return routescanAccountUrl(
    chain,
    `module=account&action=addresstokenbalance&address=${encodeURIComponent(
      address.trim(),
    )}&page=${page}&offset=${offset}`,
  );
}

/**
 * Shapes the `addresstokenbalance` answer.
 *
 * Routescan mirrors Etherscan's field names (`TokenAddress`, `TokenSymbol`,
 * `TokenQuantity`, `TokenDivisor`) but case and naming drift between explorers
 * and versions, so every field is read through a couple of spellings.
 */
export function parseRoutescanTokenBalances(payload: unknown): DiscoveredToken[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const status = readTokenString(record.status);
  // "0" with "No token found" is an empty wallet, not a failure.
  if (status === "0" && !Array.isArray(record.result)) return [];

  const result = Array.isArray(record.result)
    ? record.result
    : record.result && typeof record.result === "object"
      ? [record.result]
      : Array.isArray(payload)
        ? payload
        : [];

  const items = [];
  for (const raw of result) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const contract =
      readTokenString(item.TokenAddress) ||
      readTokenString(item.tokenAddress) ||
      readTokenString(item.contractAddress) ||
      readTokenString(item.contract);
    const divisor = readTokenNumber(item.TokenDivisor ?? item.tokenDivisor ?? item.divisor);
    const decimals =
      readTokenNumber(item.TokenDecimal ?? item.decimals) ||
      (divisor > 0 ? Math.round(Math.log10(divisor)) : 18);
    const rawBalance =
      item.TokenQuantity ?? item.tokenQuantity ?? item.balance ?? item.value ?? item.quantity;

    items.push({
      contract,
      symbol: readTokenString(item.TokenSymbol) || readTokenString(item.symbol),
      name: readTokenString(item.TokenName) || readTokenString(item.name),
      decimals,
      quantity: divisor > 0 ? readTokenNumber(rawBalance) / divisor : rawTokenQuantity(rawBalance, decimals),
      spam: item.reputation === "spam" || item.is_spam === true || item.isSpam === true,
    });
  }

  return normaliseDiscoveredTokens(items);
}

/**
 * Every ERC-20 the wallet holds on one chain according to Routescan.
 * Never throws; returns `[]` when the chain is unknown or the API is unavailable.
 */
export async function fetchRoutescanTokens(
  chain: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredToken[]> {
  const found: DiscoveredToken[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= ROUTESCAN_MAX_PAGES; page += 1) {
    const url = routescanTokenBalanceUrl(chain, address, page);
    if (!url) return found;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(ROUTESCAN_TIMEOUT_MS),
      });
      if (!response.ok) break;
      const tokens = parseRoutescanTokenBalances(await response.json());
      if (tokens.length === 0) break;

      let added = 0;
      for (const token of tokens) {
        const key = token.contract.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(token);
        added += 1;
      }
      // A short page means there is nothing more to read.
      if (added === 0 || tokens.length < ROUTESCAN_PAGE_SIZE) break;
      if (found.length >= MAX_DISCOVERED_TOKENS) break;
    } catch {
      break;
    }
  }

  return found.slice(0, MAX_DISCOVERED_TOKENS);
}
