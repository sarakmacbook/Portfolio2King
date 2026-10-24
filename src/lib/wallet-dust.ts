/**
 * Dust filter for wallet scans.
 *
 * A big wallet usually holds a long tail of tiny balances — airdropped junk,
 * test transactions, a few cents of a token — and importing all of them turns
 * the portfolio into noise. This module is the one place that decides what
 * counts as dust, so the dialog, the import action and the tests agree.
 *
 * "Value" is the USD value the scan reported (`quantity × price`), not the
 * quantity: 1,000,000 tokens worth $0.0001 each is dust too.
 */

/** The default cut-off: hide anything worth less than one dollar. */
export const DEFAULT_DUST_THRESHOLD_USD = 1;

/** A sane ceiling, so a typo cannot hide the whole portfolio. */
export const MAX_DUST_THRESHOLD_USD = 100_000;

/**
 * Reads a threshold from a form value. Blank, negative or nonsense falls back to
 * the default; anything above the ceiling is clamped.
 */
export function normaliseDustThreshold(value: unknown): number {
  // A blank box means "not typed yet", which is the default — not 0, which is a
  // deliberate "show everything".
  const digits = typeof value === "string" ? value.replace(/[^0-9.]/g, "") : "";
  const parsed =
    typeof value === "number"
      ? value
      : digits
        ? Number(digits)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DUST_THRESHOLD_USD;
  return Math.min(parsed, MAX_DUST_THRESHOLD_USD);
}

/**
 * A row's USD value. Scanned wallet balances call it `valueUsd`; holdings rows
 * (and transactions being checked server-side) call it `value`. One helper so
 * both can be filtered with the same rule.
 */
export type DustMeasurable = { valueUsd?: number; value?: number };

export function dustValueOf(item: DustMeasurable): number {
  const value =
    typeof item.valueUsd === "number" ? item.valueUsd : typeof item.value === "number" ? item.value : 0;
  return Number.isFinite(value) ? value : 0;
}

/** True when a balance is worth less than the threshold. */
export function isDust(balance: DustMeasurable, threshold: number): boolean {
  const cut = normaliseDustThreshold(threshold);
  const value = dustValueOf(balance);
  // A threshold of 0 hides nothing — "show everything" must stay possible.
  if (cut <= 0) return false;
  return value < cut;
}

export type DustSplit<T> = {
  /** What the user sees and what "Import all" imports. */
  kept: T[];
  /** The hidden balances. */
  dust: T[];
  /** How many were hidden — 0 when the filter is off. */
  dustCount: number;
  /** Their combined USD value, so the note can say what is being skipped. */
  dustValue: number;
};

/**
 * Splits scanned balances into what to show and what to hide.
 *
 * With `threshold <= 0` (or the filter switched off by passing `0`) everything
 * is kept — the filter is a convenience, never a silent deletion.
 */
export function splitDust<T extends DustMeasurable>(
  balances: readonly T[],
  threshold: number,
): DustSplit<T> {
  const cut = normaliseDustThreshold(threshold);
  if (cut <= 0) return { kept: [...balances], dust: [], dustCount: 0, dustValue: 0 };

  const kept: T[] = [];
  const dust: T[] = [];
  for (const balance of balances) {
    if (isDust(balance, cut)) dust.push(balance);
    else kept.push(balance);
  }

  return {
    kept,
    dust,
    dustCount: dust.length,
    dustValue: Number(dust.reduce((sum, balance) => sum + dustValueOf(balance), 0).toFixed(2)),
  };
}
