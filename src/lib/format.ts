import type { AssetType, TxKind } from "@/lib/constants";

export const CURRENCY = "USD";

export function money(n: number, opts: { sign?: boolean; compact?: boolean } = {}) {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: CURRENCY,
    notation: opts.compact && abs >= 100000 ? "compact" : "standard",
    minimumFractionDigits: opts.compact && abs >= 100000 ? 0 : 2,
    maximumFractionDigits: abs > 0 && abs < 1 ? 6 : 2,
  }).format(abs);
  if (n < 0) return `-${s}`;
  if (opts.sign && n > 0) return `+${s}`;
  return s;
}

export function qty(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(n);
}

export function pct(n: number, sign = true) {
  if (!isFinite(n)) return "—";
  const s = `${Math.abs(n * 100).toFixed(2)}%`;
  if (n < 0) return `-${s}`;
  return sign && n > 0 ? `+${s}` : s;
}

export function pnlColor(n: number) {
  if (n > 1e-9) return "text-emerald-600";
  if (n < -1e-9) return "text-rose-600";
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
