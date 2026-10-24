/**
 * Token discovery through Blockscout.
 *
 * DeBank answers "no tokens" for a wallet unless it is given an access key, so
 * the direct on-chain read has to do the discovery itself. Reading balances over
 * RPC only works for tokens you already know the address of — which is why a
 * wallet used to show a handful of hard-coded tickers and miss everything else.
 *
 * Blockscout is an open-source explorer with public, keyless instances on many
 * chains, and its account API lists *every* ERC-20 a wallet holds:
 *
 * - `GET /api?module=account&action=tokenlist&address=0x…` (v1, Etherscan-shaped)
 * - `GET /api/v2/addresses/0x…/token-balances` (v2, with spam reputation)
 *
 * Both are tried, both are best effort: a chain without a Blockscout instance,
 * an instance that is down or an unexpected payload simply contributes nothing
 * and the RPC read still runs. Everything that shapes a response is a pure
 * function — see tests/blockscout.test.ts.
 */
import { isStablecoinSymbol } from "@/lib/stablecoins";

/**
 * Public Blockscout instances, keyed by the app's chain ids.
 *
 * Only chains with a known public instance are listed; a chain that is missing
 * here is still scanned over RPC, it just cannot discover unknown tokens. An
 * instance that is gone is skipped silently, so a stale entry is harmless.
 */
export const BLOCKSCOUT_INSTANCES: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  optimism: "https://optimism.blockscout.com",
  arbitrum: "https://arbitrum.blockscout.com",
  polygon: "https://polygon.blockscout.com",
  gnosis: "https://gnosis.blockscout.com",
  zksync: "https://zksync.blockscout.com",
  scroll: "https://scroll.blockscout.com",
  linea: "https://linea.blockscout.com",
  mantle: "https://explorer.mantle.xyz",
  zora: "https://explorer.zora.energy",
  mode: "https://explorer.mode.network",
  celo: "https://explorer.celo.org",
  aurora: "https://explorer.aurora.dev",
};

/** How long one Blockscout call may take. */
export const BLOCKSCOUT_TIMEOUT_MS = 7000;

/** The most tokens one chain will report (spam airdrops can be endless). */
export const MAX_BLOCKSCOUT_TOKENS = 150;

export type BlockscoutToken = {
  /** Contract address (lower-case for comparison, original casing for display). */
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Whole-token quantity, ready to use. */
  quantity: number;
  stablecoin: boolean;
};

export function blockscoutBaseUrl(chain: string): string | null {
  const base = BLOCKSCOUT_INSTANCES[chain.trim().toLowerCase()];
  return base ? base.replace(/\/+$/, "") : null;
}

export function blockscoutTokenListUrl(base: string, address: string): string {
  const root = base.replace(/\/+$/, "");
  return `${root}/api?module=account&action=tokenlist&address=${encodeURIComponent(address.trim())}`;
}

export function blockscoutTokenBalancesUrl(base: string, address: string): string {
  const root = base.replace(/\/+$/, "");
  return `${root}/api/v2/addresses/${encodeURIComponent(address.trim())}/token-balances`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isContract(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

/** Splits a raw integer balance (`"12345"` or `"0x3039"`) by its decimals. */
export function blockscoutQuantity(raw: unknown, decimals: number): number {
  // `0` decimals is legitimate (some tokens have none), so it must not fall
  // back to 18 the way `|| 18` would.
  const rounded = Number.isFinite(decimals) ? Math.round(decimals) : 18;
  const digits = Math.max(0, Math.min(36, rounded));
  if (typeof raw === "string" && raw.startsWith("0x")) {
    try {
      const value = BigInt(raw);
      if (value <= BigInt(0)) return 0;
      return Number(value) / 10 ** digits;
    } catch {
      return 0;
    }
  }
  const value = readNumber(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / 10 ** digits;
}

/** Shared shaping: drop non-ERC-20 entries, spam, empty balances and duplicates. */
function toTokens(
  items: Array<{
    contract: string;
    symbol: string;
    name: string;
    decimals: number;
    quantity: number;
    spam?: boolean;
  }>,
): BlockscoutToken[] {
  const seen = new Set<string>();
  const tokens: BlockscoutToken[] = [];

  // Biggest first, so the cap keeps what is worth importing.
  for (const item of items.sort((a, b) => b.quantity - a.quantity)) {
    if (item.spam) continue;
    if (!isContract(item.contract)) continue;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    const key = item.contract.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const symbol = (item.symbol || item.name || `${item.contract.slice(0, 6)}…`).toUpperCase();
    tokens.push({
      contract: item.contract,
      symbol,
      name: item.name || symbol,
      decimals: Math.max(0, Math.min(36, Math.round(item.decimals) || 18)),
      quantity: Number(item.quantity.toFixed(8)),
      stablecoin: isStablecoinSymbol(symbol),
    });
    if (tokens.length >= MAX_BLOCKSCOUT_TOKENS) break;
  }

  return tokens;
}

/**
 * Shapes the v1 `tokenlist` response. `status: "0"` with "No tokens found" is an
 * empty wallet, not an error.
 */
export function parseBlockscoutTokenList(payload: unknown): BlockscoutToken[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const result = Array.isArray(record.result) ? record.result : Array.isArray(payload) ? payload : [];

  const items: Array<{
    contract: string;
    symbol: string;
    name: string;
    decimals: number;
    quantity: number;
    spam?: boolean;
  }> = [];

  for (const raw of result) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const type = readString(item.type).toUpperCase();
    // ERC-721 / ERC-1155 NFTs are not holdings with a quantity.
    if (type && !type.includes("20")) continue;
    const decimals = readNumber(item.decimals) || 18;
    items.push({
      contract: readString(item.contractAddress) || readString(item.contract_address),
      symbol: readString(item.symbol),
      name: readString(item.tokenName) || readString(item.name),
      decimals,
      quantity: blockscoutQuantity(item.balance ?? item.value, decimals),
      spam: item.reputation === "spam" || item.is_spam === true,
    });
  }

  return toTokens(items);
}

/** Shapes the v2 `token-balances` response (which carries spam reputation). */
export function parseBlockscoutTokenBalances(payload: unknown): BlockscoutToken[] {
  if (!Array.isArray(payload)) return [];
  const items: Array<{
    contract: string;
    symbol: string;
    name: string;
    decimals: number;
    quantity: number;
    spam?: boolean;
  }> = [];

  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const token = (entry.token && typeof entry.token === "object" ? entry.token : entry) as Record<
      string,
      unknown
    >;
    const type = readString(token.type).toUpperCase();
    if (type && !type.includes("20")) continue;
    const decimals = readNumber(token.decimals) || 18;
    const reputation = readString(token.reputation).toLowerCase();
    items.push({
      contract: readString(token.address_hash) || readString(token.address),
      symbol: readString(token.symbol),
      name: readString(token.name),
      decimals,
      quantity: blockscoutQuantity(entry.value, decimals),
      spam: reputation === "spam" || reputation === "unverified_scam",
    });
  }

  return toTokens(items);
}

/**
 * Every ERC-20 the wallet holds on one chain, according to Blockscout.
 *
 * Never throws: a missing instance, a blocked host, a rate limit or a payload
 * this code does not understand all return `[]` so the caller can carry on with
 * the RPC read.
 */
export async function fetchBlockscoutTokens(
  chain: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockscoutToken[]> {
  const base = blockscoutBaseUrl(chain);
  if (!base) return [];

  const attempts: Array<{ url: string; parse: (payload: unknown) => BlockscoutToken[] }> = [
    { url: blockscoutTokenListUrl(base, address), parse: parseBlockscoutTokenList },
    { url: blockscoutTokenBalancesUrl(base, address), parse: parseBlockscoutTokenBalances },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetchImpl(attempt.url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(BLOCKSCOUT_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const tokens = attempt.parse(await response.json());
      if (tokens.length > 0) return tokens;
    } catch {
      // Try the other endpoint, then give up on this chain.
    }
  }

  return [];
}
