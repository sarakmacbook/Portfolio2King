import type { AssetType, TxKind } from "@/lib/constants";

export const CURRENCY = "USD";

/**
 * Values this close to zero are float residue, not money. `abs > 0 && abs < 1`
 * renders six decimals, so anything under half of the smallest shown unit would
 * otherwise print as a signed zero (a red `-$0.00` in the daily card).
 */
const MONEY_EPSILON = 5e-7;
/** `qty` renders eight decimals, so half of the smallest shown unit is 5e-9. */
const QTY_EPSILON = 5e-9;
/** `pct` renders two decimals of a percentage; this only kills a signed zero. */
const PCT_EPSILON = 1e-9;

export function money(n: number, opts: { sign?: boolean; compact?: boolean } = {}) {
  // A missing or broken number (NaN from an empty quote, Infinity from a bad
  // division) is shown as "—", exactly like `pct`, instead of "$NaN".
  if (!Number.isFinite(n)) return "—";
  // Collapse float residue to a plain zero so no sign is ever attached to it.
  const value = Math.abs(n) < MONEY_EPSILON ? 0 : n;
  const abs = Math.abs(value);
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: CURRENCY,
    notation: opts.compact && abs >= 100000 ? "compact" : "standard",
    minimumFractionDigits: opts.compact && abs >= 100000 ? 0 : 2,
    maximumFractionDigits: abs > 0 && abs < 1 ? 6 : 2,
  }).format(abs);
  if (value < 0) return `-${s}`;
  if (opts.sign && value > 0) return `+${s}`;
  return s;
}

export function qty(n: number) {
  if (!Number.isFinite(n)) return "—";
  const value = Math.abs(n) < QTY_EPSILON ? 0 : n;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}

export function pct(n: number, sign = true) {
  if (!isFinite(n)) return "—";
  const value = Math.abs(n) < PCT_EPSILON ? 0 : n;
  const s = `${Math.abs(value * 100).toFixed(2)}%`;
  if (value < 0) return `-${s}`;
  return sign && value > 0 ? `+${s}` : s;
}

/**
 * Colour for a profit/loss figure. Uses the same threshold as `money`, so a row
 * that renders `$0.00` is never painted green or red.
 */
export function pnlColor(n: number) {
  if (!Number.isFinite(n)) return "text-slate-500";
  if (n >= MONEY_EPSILON) return "text-emerald-600";
  if (n <= -MONEY_EPSILON) return "text-rose-600";
  return "text-slate-500";
}

export const TYPE_META: Record<AssetType, { label: string; color: string; badge: string; icon: string }> = {
  cash: { label: "Cash", color: "#10b981", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: "💵" },
  stock: { label: "Stocks", color: "#6366f1", badge: "bg-indigo-50 text-indigo-700 ring-indigo-200", icon: "📈" },
  crypto: { label: "Crypto", color: "#f59e0b", badge: "bg-amber-50 text-amber-700 ring-amber-200", icon: "🪙" },
  other: { label: "Other", color: "#64748b", badge: "bg-slate-100 text-slate-700 ring-slate-200", icon: "📦" },
};

export const KIND_META: Record<TxKind, { label: string; badge: string }> = {
  buy: { label: "Buy", badge: "bg-indigo-50 text-indigo-700" },
  sell: { label: "Sell", badge: "bg-rose-50 text-rose-700" },
  deposit: { label: "Deposit", badge: "bg-emerald-50 text-emerald-700" },
  withdraw: { label: "Withdraw", badge: "bg-orange-50 text-orange-700" },
  dividend: { label: "Income", badge: "bg-sky-50 text-sky-700" },
};

export function kindsFor(type: AssetType): TxKind[] {
  return type === "cash" ? ["deposit", "withdraw", "dividend"] : ["buy", "sell", "dividend"];
}

export function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
