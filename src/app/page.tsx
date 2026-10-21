import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import AddAssetDialog from "@/components/AddAssetDialog";
import { Donut, HistoryChart, type Point } from "@/components/Charts";
import HoldingsTable, { type HoldingRow } from "@/components/HoldingsTable";
import RefreshPricesButton from "@/components/RefreshPricesButton";
import { KIND_META, TYPE_META, fmtDate, money, pct, pnlColor, qty } from "@/lib/format";
import {
  assetCost,
  assetValue,
  computeTotals,
  getAllAssets,
  getRecentActivity,
  getSnapshots,
  today,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const [list, snaps, activity] = await Promise.all([getAllAssets(), getSnapshots(), getRecentActivity(6)]);
  const totals = computeTotals(list);
  const cashAccounts = list.filter((a) => a.type === "cash").map((a) => ({ id: a.id, name: a.name, quantity: a.quantity }));

  const rows: HoldingRow[] = list.map((a) => {
    const value = assetValue(a);
    const cost = assetCost(a);
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      symbol: a.symbol,
      cryptoCategory: a.cryptoCategory,
      quantity: a.quantity,
      avgCost: a.avgCost,
      currentPrice: a.currentPrice,
      value,
      cost,
      pnl: value - cost,
      pnlPct: cost > 0 ? (value - cost) / cost : 0,
      weight: totals.totalValue > 0 ? value / totals.totalValue : 0,
    };
  });

  const points: Point[] = snaps.map((s) => ({ date: s.date, value: s.totalValue, cost: s.costBasis }));
  const t = today();
  if (list.length && (!points.length || points[points.length - 1].date !== t)) {
    points.push({ date: t, value: totals.totalValue, cost: totals.costBasis });
  }

  const invested = totals.costBasis - totals.cashValue;
  const unrealizedPct = invested > 0 ? totals.unrealized / invested : 0;
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const change = prev ? totals.totalValue - prev.value : 0;

  const stablecoinValue = list
    .filter((asset) => asset.type === "crypto" && asset.cryptoCategory === "stablecoin")
    .reduce((sum, asset) => sum + assetValue(asset), 0);
  const volatileCryptoValue = list
    .filter((asset) => asset.type === "crypto" && asset.cryptoCategory !== "stablecoin")
    .reduce((sum, asset) => sum + assetValue(asset), 0);
  const slices = [
    { label: "Cash", value: totals.byType.cash, color: TYPE_META.cash.color },
    { label: "Stocks", value: totals.byType.stock, color: TYPE_META.stock.color },
    { label: "Crypto · Stablecoin", value: stablecoinValue, color: "#14b8a6" },
    { label: "Crypto · Volatile", value: volatileCryptoValue, color: TYPE_META.crypto.color },
    { label: "Other", value: totals.byType.other, color: TYPE_META.other.color },
  ].filter((slice) => slice.value > 0);

  if (list.length === 0) {
    return (
      <div className="card mx-auto max-w-2xl px-8 py-14 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-indigo-50 text-3xl">◆</div>
        <h1 className="text-2xl font-semibold tracking-tight">Start tracking your portfolio</h1>
        <p className="mx-auto mt-2 max-w-md text-slate-500">
          Add your cash balances, stocks and crypto by hand. Record buys and sells, update prices whenever you like,
          and watch your allocation and performance over time.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <AddAssetDialog cashAccounts={[]} defaultType="cash" label="💵 Add cash" className="btn-ghost" />
          <AddAssetDialog cashAccounts={[]} defaultType="stock" label="📈 Add stock" className="btn-ghost" />
          <AddAssetDialog cashAccounts={[]} defaultType="crypto" label="🪙 Add crypto" className="btn-ghost" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Total portfolio value</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {money(totals.totalValue)}
          </h1>
          {prev && (
            <p className={`mt-1 text-sm font-medium ${pnlColor(change)}`}>
              {money(change, { sign: true })} ({pct(prev.value > 0 ? change / prev.value : 0)}) since {fmtDate(prev.date)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <RefreshPricesButton />
          <AddAssetDialog cashAccounts={cashAccounts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cash" value={money(totals.cashValue)} hint={`${pct(totals.totalValue ? totals.cashValue / totals.totalValue : 0, false)} of portfolio`} />
        <Stat label="Invested (cost basis)" value={money(invested)} hint={`${list.filter((a) => a.type !== "cash").length} positions`} />
        <Stat
          label="Unrealized P/L"
          value={money(totals.unrealized, { sign: true })}
          valueClass={pnlColor(totals.unrealized)}
          hint={pct(unrealizedPct)}
          hintClass={pnlColor(totals.unrealized)}
        />
        <Stat
          label="Realized P/L + income"
          value={money(totals.realized, { sign: true })}
          valueClass={pnlColor(totals.realized)}
          hint="From sells, dividends & interest"
        />
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-semibold text-slate-900">Holdings</h2>
        </div>
        <HoldingsTable rows={rows} />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <h2 className="mb-3 font-semibold text-slate-900">Value history</h2>
          <HistoryChart points={points} />
        </section>
        <section className="card min-w-0 p-4 sm:p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold text-slate-900">Allocation</h2>
          <Donut slices={slices} centerLabel="Total" />
        </section>
      </div>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Recent activity</h2>
          <Link href="/activity" className="text-sm font-medium text-indigo-600 hover:underline">
            View all →
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {activity.map(({ tx, asset }) => (
            <li key={tx.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${KIND_META[tx.kind].badge}`}>
                  {KIND_META[tx.kind].label}
                </span>
                <Link href={`/assets/${asset.id}`} className="truncate font-medium text-slate-800 hover:text-indigo-600">
                  {asset.symbol || asset.name}
                </Link>
                <span className="hidden truncate text-slate-500 sm:inline">
                  {asset.type === "cash" || tx.kind === "dividend" ? "" : `${qty(tx.quantity)} @ ${money(tx.price)}`}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="font-medium tabular-nums text-slate-900">{money(tx.quantity * tx.price)}</span>
                <span className="w-24 text-right text-xs text-slate-400">{fmtDate(tx.date)}</span>
              </div>
            </li>
          ))}
          {activity.length === 0 && <li className="py-6 text-center text-sm text-slate-400">No activity yet</li>}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClass = "text-slate-900",
  hintClass = "text-slate-500",
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  hintClass?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {hint && <p className={`mt-0.5 text-xs ${hintClass}`}>{hint}</p>}
    </div>
  );
}
