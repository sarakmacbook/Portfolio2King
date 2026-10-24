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

/** What a set of tokens adds up to; an unpriced token counts as nothing. */
export function walletValueUsd(balances: readonly { valueUsd?: number }[]): number {
  return balances.reduce((sum, item) => sum + positiveUsd(item.valueUsd), 0);
}
