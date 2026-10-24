/**
 * The shared shape for a token found by an explorer (Blockscout, Routescan, …).
 *
 * Discovery is the part of a wallet scan that does not come from RPC: an
 * explorer knows *which* tokens a wallet holds, RPC only knows how much of a
 * token you ask about. Several explorers are tried per chain, so they all speak
 * this one shape and one merge step decides what survives.
 */
import { isStablecoinSymbol } from "@/lib/stablecoins";

export type DiscoveredToken = {
  /** Contract address, original casing (comparisons are case-insensitive). */
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Whole-token quantity, ready to use. */
  quantity: number;
  /** USD-pegged ticker, filed as a stablecoin rather than volatile. */
  stablecoin: boolean;
};

export type RawDiscoveredToken = {
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  quantity: number;
  /** Explorer's own spam/reputation flag — dropped when true. */
  spam?: boolean;
};

/** The most tokens one chain will report (spam airdrops can be endless). */
export const MAX_DISCOVERED_TOKENS = 150;

export function isTokenContract(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function readTokenString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readTokenNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Turns a raw integer balance (`"1500000000000000000"` or `"0x14d…"`) into whole
 * tokens. `0` decimals is legitimate and must not fall back to 18.
 */
export function rawTokenQuantity(raw: unknown, decimals: number): number {
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
  const value = readTokenNumber(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / 10 ** digits;
}

/**
 * Cleans one explorer's answer: drops spam, non-contract entries, empty
 * balances and duplicates, upper-cases symbols and keeps the biggest holdings
 * when there are more than the cap.
 */
export function normaliseDiscoveredTokens(
  items: readonly RawDiscoveredToken[],
  maxItems = MAX_DISCOVERED_TOKENS,
): DiscoveredToken[] {
  const seen = new Set<string>();
  const tokens: DiscoveredToken[] = [];

  // Biggest first, so the cap keeps what is worth importing.
  for (const item of [...items].sort((a, b) => b.quantity - a.quantity)) {
    if (item.spam) continue;
    if (!isTokenContract(item.contract)) continue;
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
    if (tokens.length >= maxItems) break;
  }

  return tokens;
}

/**
 * Merges several sources for the same chain. The first source wins a contract
 * it already reported (so a richer entry — a name, a logo — is not replaced by
 * a poorer one), and the result is capped again after merging.
 */
export function mergeDiscoveredTokens(
  ...sources: ReadonlyArray<readonly DiscoveredToken[]>
): DiscoveredToken[] {
  const seen = new Set<string>();
  const merged: DiscoveredToken[] = [];

  for (const source of sources) {
    for (const token of source) {
      const key = token.contract.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(token);
    }
  }

  return merged
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, MAX_DISCOVERED_TOKENS);
}
