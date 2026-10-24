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

import {
  cmcApiKey,
  cmcMatchFor,
  fetchCmcContracts,
  mergeContractStatus,
  type CmcMatch,
} from "@/lib/coinmarketcap";
import { isDust, type DustMeasurable } from "@/lib/wallet-dust";
import { isSpamToken } from "@/lib/wallet-spam";
import {
  MIN_LIQUIDITY_USD,
  MIN_ORGANIC_VOLUME_USD,
  fetchMarketSignals,
  isShallowLiquidity,
  isThinMarket,
  liquidityDepth,
  type LiquidityDepth,
} from "@/lib/organic-volume";
import { contractStatusOf, normaliseEvmContract, type ContractStatus } from "@/lib/token-trust";

/**
 * Where a token stands on being *real*, as opposed to merely present.
 *
 *   verified   — an issuer/indexer says so, or it trades in a deep market
 *   unverified — positive evidence of junk: a spam verdict, or a market known
 *                to be too thin to back the price it shows
 *   unknown    — nothing could be checked (no explorer, no market answer)
 *
 * The distinction matters: a scan must never hide a real holding because a third
 * party was down, so only `unverified` is ever hidden by default.
 */
export type Verification = "verified" | "unverified" | "unknown";

export type TrustSignals = {
  /** Official-contract match; `unknown` when the token is not in the table. */
  contractStatus?: ContractStatus;
  /** 24h organic DEX volume in USD, when DexScreener answered. */
  organicVolumeUsd?: number;
  /** Liquidity of the pools that count, in USD. */
  liquidityUsd?: number;
  /** Liquidity of the token's single deepest pool. */
  deepestPoolUsd?: number;
  /** True when the pools are deep enough to call the token real. */
  deepLiquidity?: boolean;
  /** How many pairs the token trades in. */
  marketPairs?: number;
  /** A pool traded an implausible multiple of its own liquidity. */
  washSuspected?: boolean;
  /** The scan's own verdict (see `Verification`). */
  verification?: Verification;
  /** Why it was verified — "official contract", "indexer", "deep market", "CoinMarketCap". */
  verifiedBy?: string[];
  /** CoinMarketCap's id, name and slug for the coin this contract belongs to. */
  cmcId?: number;
  cmcName?: string;
  cmcSlug?: string;
  /** The contract is listed on CoinMarketCap and its ticker agrees. */
  cmcVerified?: boolean;
  /**
   * Listed, but under a different ticker than the scan showed. A note, never a
   * reason to hide: `RNDR` → `RENDER` and bridged `USDC.e` are honest renames.
   */
  cmcSymbolMismatch?: boolean;
  /** USD price from CoinMarketCap, used only when nothing else priced the token. */
  cmcPriceUsd?: number;
};

type TrustableBalance = {
  symbol?: string | null;
  name?: string | null;
  contract?: string | null;
  chain?: string | null;
  /** The indexer's spam verdict (DeBank `is_scam`, Moralis `possible_spam`, …). */
  spam?: boolean | null;
  /** The indexer's verification (DeBank `is_verified`, Moralis `verified_contract`, …). */
  verified?: boolean | null;
  /** Enough to be re-priced by CoinMarketCap when nothing else had a price. */
  quantity?: number;
  price?: number;
  valueUsd?: number;
  priced?: boolean;
};

export type TrustOptions = {
  /**
   * The CoinMarketCap key. Empty disables the contract lookup and leaves every
   * verdict exactly as it was before CMC existed.
   */
  cmcApiKey?: string;
  /** The fetch used for CoinMarketCap (separate so one can be stubbed alone). */
  cmcFetchImpl?: typeof fetch;
  /**
   * Told whether the CoinMarketCap lookup actually ran, and how many of the
   * scanned contracts it recognised. The caller needs this because "not listed"
   * and "never asked" look identical on a balance — and a filter that hides
   * unlisted tokens must switch itself off when nothing was asked, or a missing
   * key would empty the picker.
   */
  onCmcLookup?: (report: { ok: boolean; asked: number; listed: number }) => void;
};

/**
 * Liquidity a token needs before its market counts as proof it is real.
 *
 * `MIN_LIQUIDITY_USD` ($2k) is the floor for "this has *a* market"; verification
 * asks for real money, because a spam token only needs a few hundred dollars of
 * pooled liquidity to show a price. Pooled depth is the part of a fake token that
 * costs actual money, so this is deliberately the strict half of the test.
 */
export const VERIFIED_LIQUIDITY_USD = 25_000;
/** And one pool, not twenty dust pools. */
export const VERIFIED_DEEPEST_POOL_USD = 5_000;

/**
 * The verification verdict for one balance, from what the scan already knows.
 *
 * Verified by any of: the official-contract table, the indexer's own verdict, or
 * a deep market with real organic volume. Unverified only on positive evidence —
 * a spam flag, or market numbers that show the price is not backed by anything.
 */
export function verificationOf(
  balance: TrustableBalance & TrustSignals,
  options: { minOrganicVolumeUsd?: number } = {},
): Verification {
  if (balance.spam === true) return "unverified";

  const status = balance.contractStatus ?? contractStatusOf(balance);
  if (status === "official") return "verified";
  if (balance.cmcVerified === true) return "verified";
  if (balance.verified === true) return "verified";

  const volume = balance.organicVolumeUsd;
  const liquidity = balance.liquidityUsd;
  // No market answer at all (or a chain DexScreener does not index): unknown.
  if (volume === undefined && liquidity === undefined) return "unknown";

  const minVolume =
    Number.isFinite(options.minOrganicVolumeUsd) && (options.minOrganicVolumeUsd as number) > 0
      ? (options.minOrganicVolumeUsd as number)
      : MIN_ORGANIC_VOLUME_USD;
  const deep =
    (liquidity ?? 0) >= VERIFIED_LIQUIDITY_USD &&
    (balance.deepestPoolUsd ?? 0) >= VERIFIED_DEEPEST_POOL_USD &&
    (volume ?? 0) >= minVolume;
  return deep ? "verified" : "unverified";
}

/** Short label for the UI, e.g. `official ✓` already exists — this names the source. */
export function verifiedByOf(balance: TrustableBalance & TrustSignals): string[] {
  const reasons: string[] = [];
  const status = balance.contractStatus ?? contractStatusOf(balance);
  if (status === "official") reasons.push("official contract");
  if (balance.cmcVerified === true) reasons.push("CoinMarketCap");
  if (balance.verified === true) reasons.push("indexer");
  if (
    reasons.length === 0 &&
    (balance.liquidityUsd ?? 0) >= VERIFIED_LIQUIDITY_USD &&
    (balance.deepestPoolUsd ?? 0) >= VERIFIED_DEEPEST_POOL_USD
  ) {
    reasons.push("deep market");
  }
  return reasons;
}

/**
 * Adds contract status to every balance and market signals to the EVM ones.
 *
 * Never throws and never drops a balance: anything the lookup could not answer is
 * left undefined, which every caller reads as "unknown".
 */
export async function enrichTokenTrust<T extends TrustableBalance>(
  balances: readonly T[],
  fetchImpl: typeof fetch = fetch,
  options: TrustOptions = {},
): Promise<Array<T & TrustSignals>> {
  /** Every balance leaves with a verdict, even when no lookup was possible. */
  const withVerdict = <R extends TrustableBalance & TrustSignals>(rows: readonly R[]) =>
    rows.map((row) => ({
      ...row,
      verification: verificationOf(row),
      ...(verificationOf(row) === "verified" ? { verifiedBy: verifiedByOf(row) } : {}),
    }));

  const contracts = balances
    .map((balance) => normaliseEvmContract(balance.contract))
    .filter((contract): contract is string => Boolean(contract));

  /**
   * CoinMarketCap runs *beside* DexScreener: it answers which coin a contract is
   * (for the long tail the local table has never heard of), whether the ticker is
   * honest, and a USD price for anything the scan could not price. It never
   * blocks the market lookup, and a missing key simply skips it.
   */
  const cmcKey = (options.cmcApiKey ?? cmcApiKey()).trim();
  const marketPromise: Promise<Awaited<ReturnType<typeof fetchMarketSignals>> | null> =
    contracts.length === 0
      ? Promise.resolve(null)
      : fetchMarketSignals(contracts, fetchImpl).catch(() => null);

  const [cmc, signals] = await Promise.all([
    cmcKey && contracts.length > 0
      ? fetchCmcContracts(contracts, {
          apiKey: cmcKey,
          ...(options.cmcFetchImpl ? { fetchImpl: options.cmcFetchImpl } : {}),
        }).catch(() => null)
      : Promise.resolve(null),
    marketPromise,
  ]);

  if (options.onCmcLookup) {
    const listed = balances.filter((balance) => {
      const contract = normaliseEvmContract(balance.contract);
      return Boolean(contract && cmc?.info.has(contract));
    }).length;
    options.onCmcLookup({
      ok: Boolean(cmc?.ok),
      asked: contracts.length,
      listed,
    });
  }

  const withStatus = balances.map((balance) => {
    const contract = normaliseEvmContract(balance.contract);
    const match: CmcMatch | null = contract && cmc ? cmcMatchFor(balance, cmc.info) : null;
    const local = contractStatusOf(balance);
    const cmcPriceUsd = match?.token ? cmc?.prices.get(match.token.id) : undefined;

    /**
     * A token nothing else could price takes CoinMarketCap's price, so it stops
     * being "no price yet" — and therefore gets a real dust decision. A price the
     * scan already had is never overwritten.
     */
    const quantity = Number(balance.quantity);
    const unpriced = balance.priced === false || !(Number(balance.price) > 0);
    const repriced =
      unpriced && cmcPriceUsd && cmcPriceUsd > 0 && Number.isFinite(quantity) && quantity > 0
        ? {
            price: cmcPriceUsd,
            valueUsd: Number((quantity * cmcPriceUsd).toFixed(2)),
            priced: true,
          }
        : {};

    return {
      ...balance,
      ...repriced,
      contractStatus: mergeContractStatus(local, match),
      ...(match?.token
        ? {
            cmcId: match.token.id,
            cmcName: match.token.name,
            cmcSlug: match.token.slug,
            ...(match.status === "official" ? { cmcVerified: true } : {}),
            ...(match.symbolMismatch ? { cmcSymbolMismatch: true } : {}),
          }
        : {}),
      ...(cmcPriceUsd && cmcPriceUsd > 0 ? { cmcPriceUsd } : {}),
    };
  });

  if (!signals || contracts.length === 0) return withVerdict(withStatus);

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
    // A chain with no pairs anywhere is not indexed by DexScreener: its tokens
    // stay unknown rather than "no market".
    if (!market || blindChains.has(String(balance.chain ?? ""))) {
      return {
        ...balance,
        verification: verificationOf(balance),
        ...(verificationOf(balance) === "verified" ? { verifiedBy: verifiedByOf(balance) } : {}),
      };
    }
    const enriched = {
      ...balance,
      organicVolumeUsd: market.organicVolume24hUsd,
      liquidityUsd: market.liquidityUsd,
      deepestPoolUsd: market.deepestPoolUsd,
      deepLiquidity: market.deepLiquidity,
      marketPairs: market.pairs,
      washSuspected: market.washSuspected,
    };
    return {
      ...enriched,
      verification: verificationOf(enriched),
      ...(verificationOf(enriched) === "verified" ? { verifiedBy: verifiedByOf(enriched) } : {}),
    };
  });
}

/** The depth verdict for one scanned balance, for a badge or a tooltip. */
export function depthOf(balance: TrustSignals): LiquidityDepth {
  if (balance.liquidityUsd === undefined && balance.deepLiquidity === undefined) return "unknown";
  return liquidityDepth({
    liquidityUsd: balance.liquidityUsd ?? 0,
    deepLiquidity: balance.deepLiquidity ?? false,
  });
}

export type ScannableBalance = TrustableBalance &
  DustMeasurable &
  TrustSignals & {
    /** The scan's own spam flag, if it carried one. */
    spam?: boolean | null;
    /** CoinMarketCap's id, when the contract is listed (set by the trust pass). */
    cmcId?: number;
  };

export type ScanFilters = {
  /** Hide tokens that look like airdrop spam (on by default). */
  hideSpam?: boolean;
  /**
   * Hide tokens the scan *positively* judged not real — a spam verdict, or a
   * market too shallow to back the price shown (on by default). `unknown` is
   * always kept, so a missing answer never hides a real holding.
   */
  requireVerified?: boolean;
  /** Hide balances worth less than this many dollars (0 = show everything). */
  dustCut?: number;
  /** Hide tokens whose contract is not the official one for their symbol. */
  hideImpostor?: boolean;
  /**
   * Show only tokens CoinMarketCap lists for their contract.
   *
   * Off unless the lookup actually ran: callers pass it only when
   * `onCmcLookup` reported `ok`, because a missing key or a rate limit must never
   * empty the picker. A listed contract stays even when its ticker differs (a
   * rename or a bridge), which is how a real token like `USDC.e` survives.
   */
  onlyCmc?: boolean;
  /** Hide tokens with no real market (unknown data is always kept). */
  requireMarket?: boolean;
  /** Volume floor for `requireMarket`. */
  minOrganicVolumeUsd?: number;
  /**
   * Liquidity floor for `requireMarket`. Depth is what a fake token cannot
   * cheaply fake, so this is the "is it real?" half of the test.
   */
  minLiquidityUsd?: number;
};

export type ScanSelection<T> = {
  /** What the picker lists and "Import selected" imports. */
  kept: T[];
  /** Wrong contract for a known symbol — the impersonation case. */
  impostor: T[];
  /** Airdrop bait: a website or promo wording in the name. */
  spam: T[];
  /**
   * No real market: traded less than the volume floor in the last 24 hours, or
   * holding less liquidity than the depth floor.
   */
  thin: T[];
  /** Worth less than the dust cut-off. */
  dust: T[];
  /** Not verified: no issuer, no indexer verdict, and no deep market behind it. */
  unverified: T[];
  /** CoinMarketCap does not list this contract (see `onlyCmc`). */
  unlisted: T[];
  counts: {
    total: number;
    kept: number;
    impostor: number;
    spam: number;
    thin: number;
    dust: number;
    unverified: number;
    unlisted: number;
  };
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
  const requireVerified = filters.requireVerified !== false;
  const onlyCmc = filters.onlyCmc === true;
  const dustCut = Number.isFinite(filters.dustCut) && (filters.dustCut as number) > 0 ? (filters.dustCut as number) : 0;
  const minVolume =
    Number.isFinite(filters.minOrganicVolumeUsd) && (filters.minOrganicVolumeUsd as number) > 0
      ? (filters.minOrganicVolumeUsd as number)
      : MIN_ORGANIC_VOLUME_USD;
  const minLiquidity =
    Number.isFinite(filters.minLiquidityUsd) && (filters.minLiquidityUsd as number) > 0
      ? (filters.minLiquidityUsd as number)
      : MIN_LIQUIDITY_USD;

  const kept: T[] = [];
  const impostor: T[] = [];
  const spam: T[] = [];
  const thin: T[] = [];
  const dust: T[] = [];
  const unverified: T[] = [];
  const unlisted: T[] = [];

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
    /**
     * The strictest filter the app has: only tokens CoinMarketCap knows for that
     * exact contract. A balance with no contract (a native coin) has nothing to
     * look up, so it is never hidden here.
     */
    if (onlyCmc && normaliseEvmContract(balance.contract) && balance.cmcId === undefined) {
      unlisted.push(balance);
      continue;
    }
    /**
     * The scan's own verdict: the token was judged not real (a spam flag, or a
     * market that cannot back its price). Only `unverified` is hidden — a token
     * with no answer stays, because a rate-limited lookup is not evidence.
     */
    if (requireVerified && balance.verification === "unverified") {
      unverified.push(balance);
      continue;
    }
    if (requireMarket) {
      const organic = balance.organicVolumeUsd;
      const liquidity = balance.liquidityUsd;
      const traded =
        isThinMarket(organic === undefined ? undefined : { organicVolume24hUsd: organic }, minVolume) ||
        isShallowLiquidity(liquidity === undefined ? undefined : { liquidityUsd: liquidity }, minLiquidity);
      if (traded) {
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
    unverified,
    unlisted,
    counts: {
      total: balances.length,
      kept: kept.length,
      impostor: impostor.length,
      spam: spam.length,
      thin: thin.length,
      dust: dust.length,
      unverified: unverified.length,
      unlisted: unlisted.length,
    },
    dustValue: sum(dust),
    keptValue: sum(kept),
  };
}
