/**
 * Trust checks for wallet scans: is this the real token, and is anyone actually
 * trading it?
 *
 * Two different lies arrive in the same scan result:
 *
 *   - a **fake contract** using a real symbol (`USDT` deployed yesterday)
 *   - a **token with no market** — nobody trades it, so the price the indexer
 *     shows is whatever the minter typed in
 *
 * Both are answered here and both stay *optional*: this module never deletes a
 * balance, it sorts the scan into buckets so the dialog can hide what it is sure
 * about, count it, and put it back in one click. `unknown` always counts as
 * "keep" — missing data must never hide a real holding.
 */

import { isDust, type DustMeasurable } from "@/lib/wallet-dust";
import { isSpamToken } from "@/lib/wallet-spam";
import { MIN_ORGANIC_VOLUME_USD, fetchMarketSignals, isThinMarket } from "@/lib/organic-volume";
import { contractStatusOf, normaliseEvmContract, type ContractStatus } from "@/lib/token-trust";

export type TrustSignals = {
  /** Official-contract match; `unknown` when the token is not in the table. */
  contractStatus?: ContractStatus;
  /** 24h organic DEX volume in USD, when DexScreener answered. */
  organicVolumeUsd?: number;
  /** Liquidity of the pools that count, in USD. */
  liquidityUsd?: number;
  /** How many pairs the token trades in. */
  marketPairs?: number;
  /** A pool traded an implausible multiple of its own liquidity. */
  washSuspected?: boolean;
};

type TrustableBalance = {
  symbol?: string | null;
  name?: string | null;
  contract?: string | null;
  chain?: string | null;
};

/**
 * Adds contract status to every balance and market signals to the EVM ones.
 *
 * Never throws and never drops a balance: anything the lookup could not answer is
 * left undefined, which every caller reads as "unknown".
 */
export async function enrichTokenTrust<T extends TrustableBalance>(
  balances: readonly T[],
  fetchImpl: typeof fetch = fetch,
): Promise<Array<T & TrustSignals>> {
  const withStatus = balances.map((balance) => ({
    ...balance,
    contractStatus: contractStatusOf(balance),
  }));

  const contracts = withStatus
    .map((balance) => normaliseEvmContract(balance.contract))
    .filter((contract): contract is string => Boolean(contract));
  if (contracts.length === 0) return withStatus;

  let signals: Awaited<ReturnType<typeof fetchMarketSignals>>;
  try {
    signals = await fetchMarketSignals(contracts, fetchImpl);
  } catch {
    return withStatus;
  }

  /**
   * A chain DexScreener does not index answers "no pairs" for every token on it,
   * which is not the same as "nobody trades this token". When nothing at all was
   * found on a chain, its tokens stay *unknown* — better to keep a token the app
   * cannot judge than to hide a real holding on an uncovered chain.
   */
  const perChain = new Map<string, { seen: number; withPairs: number }>();
  for (const balance of withStatus) {
    const contract = normaliseEvmContract(balance.contract);
    const market = contract ? signals.get(contract) : undefined;
    if (!market) continue;
    const chain = String(balance.chain ?? "");
    const entry = perChain.get(chain) ?? { seen: 0, withPairs: 0 };
    entry.seen += 1;
    if (market.pairs > 0) entry.withPairs += 1;
    perChain.set(chain, entry);
  }
  const blindChains = new Set(
    [...perChain.entries()]
      .filter(([, entry]) => entry.withPairs === 0)
      .map(([chain]) => chain),
  );

  return withStatus.map((balance) => {
    const contract = normaliseEvmContract(balance.contract);
    const market = contract ? signals.get(contract) : undefined;
    if (!market) return balance;
    if (blindChains.has(String(balance.chain ?? ""))) return balance;
    return {
      ...balance,
      organicVolumeUsd: market.organicVolume24hUsd,
      liquidityUsd: market.liquidityUsd,
      marketPairs: market.pairs,
      washSuspected: market.washSuspected,
    };
  });
}

export type ScannableBalance = TrustableBalance &
  DustMeasurable &
  TrustSignals & {
    /** The scan's own spam flag, if it carried one. */
    spam?: boolean | null;
  };

export type ScanFilters = {
  /** Hide tokens that look like airdrop spam (on by default). */
  hideSpam?: boolean;
  /** Hide balances worth less than this many dollars (0 = show everything). */
  dustCut?: number;
  /** Hide tokens whose contract is not the official one for their symbol. */
  hideImpostor?: boolean;
  /** Hide tokens with no organic trading (unknown volume is kept). */
  requireMarket?: boolean;
  /** Volume floor for `requireMarket`. */
  minOrganicVolumeUsd?: number;
};

export type ScanSelection<T> = {
  /** What the picker lists and "Import selected" imports. */
  kept: T[];
  /** Wrong contract for a known symbol — the impersonation case. */
  impostor: T[];
  /** Airdrop bait: a website or promo wording in the name. */
  spam: T[];
  /** Traded less than the floor in the last 24 hours. */
  thin: T[];
  /** Worth less than the dust cut-off. */
  dust: T[];
  counts: { total: number; kept: number; impostor: number; spam: number; thin: number; dust: number };
  /** Combined USD value of the dust bucket. */
  dustValue: number;
  /** Combined USD value of everything that will be imported. */
  keptValue: number;
};

function valueOf(balance: DustMeasurable): number {
  const value =
    typeof balance.valueUsd === "number"
      ? balance.valueUsd
      : typeof balance.value === "number"
        ? balance.value
        : 0;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Splits a scan into what to import and what to leave out, with a count for each
 * reason. Order matters only for the note: impersonation is reported before
 * "no market", which is reported before dust.
 */
export function filterScanBalances<T extends ScannableBalance>(
  balances: readonly T[],
  filters: ScanFilters = {},
): ScanSelection<T> {
  const hideSpam = filters.hideSpam !== false;
  const hideImpostor = filters.hideImpostor !== false;
  const requireMarket = filters.requireMarket !== false;
  const dustCut = Number.isFinite(filters.dustCut) && (filters.dustCut as number) > 0 ? (filters.dustCut as number) : 0;
  const minVolume =
    Number.isFinite(filters.minOrganicVolumeUsd) && (filters.minOrganicVolumeUsd as number) > 0
      ? (filters.minOrganicVolumeUsd as number)
      : MIN_ORGANIC_VOLUME_USD;

  const kept: T[] = [];
  const impostor: T[] = [];
  const spam: T[] = [];
  const thin: T[] = [];
  const dust: T[] = [];

  for (const balance of balances) {
    // The scan already answered this; recomputing keeps a hand-built balance
    // (tests, a stale client) honest.
    const status = balance.contractStatus ?? contractStatusOf(balance);
    if (hideImpostor && status === "different") {
      impostor.push(balance);
      continue;
    }
    if (hideSpam && isSpamToken(balance)) {
      spam.push(balance);
      continue;
    }
    if (requireMarket) {
      const organic = balance.organicVolumeUsd;
      const signals = organic === undefined ? undefined : { organicVolume24hUsd: organic };
      if (isThinMarket(signals, minVolume)) {
        thin.push(balance);
        continue;
      }
    }
    if (dustCut > 0 && isDust(balance, dustCut)) {
      dust.push(balance);
      continue;
    }
    kept.push(balance);
  }

  const sum = (rows: readonly T[]) => Number(rows.reduce((total, row) => total + valueOf(row), 0).toFixed(2));

  return {
    kept,
    impostor,
    spam,
    thin,
    dust,
    counts: {
      total: balances.length,
      kept: kept.length,
      impostor: impostor.length,
      spam: spam.length,
      thin: thin.length,
      dust: dust.length,
    },
    dustValue: sum(dust),
    keptValue: sum(kept),
  };
}
