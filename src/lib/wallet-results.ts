/**
 * Arranging the tokens a wallet scan found.
 *
 * The picker shows up to a few hundred cards across twenty-odd chains, so the
 * numbers a person actually looks at — what the ticked tokens add up to, how
 * much each chain holds — are computed here rather than inline in the dialog,
 * and covered by tests.
 */
import type { ScannedWalletBalance } from "./wallet-scanner";

/** Anything the search box can look at. A scan row has all of it. */
export type SearchableBalance = Pick<
  ScannedWalletBalance,
  "symbol" | "name" | "chain" | "chainLabel" | "valueUsd"
> & {
  cmcName?: string;
  /** CoinMarketCap's ticker for the contract, when it differs from the scan's. */
  cmcSymbol?: string;
};

/** What one chain holds: its tokens, sorted as they came, and their total. */
export type WalletChainGroup<T> = {
  /** Lower-cased chain id, used as the React key. */
  chain: string;
  /** The chain's display label, as the scan sent it. */
  label: string;
  items: T[];
  /** USD value of everything in the group that has a price. */
  valueUsd: number;
};

/**
 * The tokens matching a search query, case-insensitively, by ticker, name,
 * chain id, chain label or CoinMarketCap's name. An empty query matches
 * everything, so the caller never needs a branch.
 */
export function searchWalletBalances<T extends SearchableBalance>(
  balances: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...balances];
  return balances.filter((item) =>
    [item.symbol, item.name, item.chain, item.chainLabel, item.cmcName ?? "", item.cmcSymbol ?? ""].some(
      (field) => field.toLowerCase().includes(needle),
    ),
  );
}

/**
 * One group per chain, biggest by USD value first (then alphabetically, so the
 * order is stable when nothing is priced). A wallet spread over twenty chains is
 * otherwise a flat wall of cards with no sense of where the money is.
 */
export function groupWalletBalancesByChain<T extends SearchableBalance>(
  balances: readonly T[],
): Array<WalletChainGroup<T>> {
  const groups = new Map<string, WalletChainGroup<T>>();
  for (const item of balances) {
    const key = item.chain.trim().toLowerCase() || item.chainLabel.toLowerCase();
    const group = groups.get(key) ?? { chain: key, label: item.chainLabel, items: [], valueUsd: 0 };
    group.items.push(item);
    group.valueUsd += positiveUsd(item.valueUsd);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.valueUsd - a.valueUsd || a.label.localeCompare(b.label),
  );
}

/** A value that can be added up: a missing, zero or nonsense price adds nothing. */
function positiveUsd(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}

/** The fields the ranking needs: a value, a cap and how sure the app is. */
export type RankableBalance = {
  valueUsd?: number;
  marketCapUsd?: number;
  verification?: "verified" | "unverified" | "unknown";
};

/** How to order the picker. */
export type ScanSort = "best" | "value" | "marketCap";

/**
 * The order options offered in the dialog, best first — which is also the
 * default: the tokens the app is *sure* about and that are worth something come
 * to the top, instead of the biggest airdrop ahead of the biggest holding.
 */
export const SCAN_SORTS: ReadonlyArray<{ id: ScanSort; label: string }> = [
  { id: "best", label: "Real & big first" },
  { id: "value", label: "Biggest holding" },
  { id: "marketCap", label: "Biggest market cap" },
];

function cap(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}

/**
 * Orders the tokens a scan found.
 *
 *   best      — verified tokens first, then by market cap, then by value: the
 *               "show me the serious ones" order.
 *   value     — what the holding is worth today.
 *   marketCap — how big the coin is, with anything uncapped last.
 *
 * Every order is a stable sort on a copy; nothing is dropped, and a token with no
 * data sorts last instead of disappearing.
 */
export function sortWalletBalances<T extends RankableBalance>(
  balances: readonly T[],
  sort: ScanSort,
): T[] {
  const rows = [...balances];
  if (sort === "value") {
    return rows.sort((a, b) => cap(b.valueUsd) - cap(a.valueUsd));
  }
  if (sort === "marketCap") {
    return rows.sort((a, b) => cap(b.marketCapUsd) - cap(a.marketCapUsd) || cap(b.valueUsd) - cap(a.valueUsd));
  }
  const verified = (row: T) => (row.verification === "verified" ? 1 : 0);
  return rows.sort(
    (a, b) =>
      verified(b) - verified(a) ||
      cap(b.marketCapUsd) - cap(a.marketCapUsd) ||
      cap(b.valueUsd) - cap(a.valueUsd),
  );
}

/**
 * How big the coin is, in words the picker can colour: `major` ($1B+), `large`
 * ($50M+, the point where a cap is evidence of being real), `mid` ($1M+) and
 * `small` (a known cap below that). `unknown` is the absence of an answer, never
 * a judgement.
 */
export type MarketCapTier = "major" | "large" | "mid" | "small" | "unknown";

export function marketCapTier(value: number | undefined): MarketCapTier {
  const usd = cap(value);
  if (usd <= 0) return "unknown";
  if (usd >= 1_000_000_000) return "major";
  if (usd >= 50_000_000) return "large";
  if (usd >= 1_000_000) return "mid";
  return "small";
}

/** `$1.2B`, `$45.0M`, `$820k` — a cap, short enough for a badge. */
export function shortMarketCap(value: number | undefined): string {
  const usd = cap(value);
  if (usd <= 0) return "";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${(usd / 1_000).toFixed(0)}k`;
}

/** What a set of tokens adds up to; an unpriced token counts as nothing. */
export function walletValueUsd(balances: readonly { valueUsd?: number }[]): number {
  return balances.reduce((sum, item) => sum + positiveUsd(item.valueUsd), 0);
}
