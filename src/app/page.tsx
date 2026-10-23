import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import AddAssetDialog from "@/components/AddAssetDialog";
import AutoDailySnapshot from "@/components/AutoDailySnapshot";
import { Donut, HistoryChart, type Point } from "@/components/Charts";
import DashboardLayout from "@/components/DashboardLayout";
import HoldingsTable, { type HoldingRow } from "@/components/HoldingsTable";
import PortfolioValueHeader from "@/components/PortfolioValueHeader";
import RefreshPricesButton from "@/components/RefreshPricesButton";
import {
  loadDashboardOrder,
  loadDashboardStatLabels,
  loadDashboardStatOrder,
} from "@/lib/dashboard-order-db";
import { KIND_META, TYPE_META, fmtDate, money, pct, pnlColor, qty } from "@/lib/format";
import {
  assetCost,
  assetValue,
  computeTotals,
  getAllAssets,
  getAllPriceSnapshots,
  getRecentActivity,
  getSnapshots,
  localDateString,
  today,
} from "@/lib/portfolio";
import { buildAssetPriceSeries, latestDailyPriceChange, type PricePoint } from "@/lib/price-history";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const list = await getAllAssets();
  const [snaps, priceSnaps, activity, dashboardOrder, statOrder, statLabels] = await Promise.all([
    getSnapshots(),
    getAllPriceSnapshots(),
    getRecentActivity(6),
    loadDashboardOrder(),
    loadDashboardStatOrder(),
    loadDashboardStatLabels(),
  ]);
  const totals = computeTotals(list);
  const t = today();
  const stalePrices = list.some(
    (a) =>
      (a.type === "crypto" || a.type === "stock") &&
      a.symbol.trim() !== "" &&
      localDateString(a.priceUpdatedAt) < t,
  );

  const byAsset = new Map<number, PricePoint[]>();
  for (const row of priceSnaps) {
    const existing = byAsset.get(row.assetId) ?? [];
    existing.push({ date: row.date, price: row.price });
    byAsset.set(row.assetId, existing);
  }

  const cashAccounts = list.filter((a) => a.type === "cash").map((a) => ({ id: a.id, name: a.name, quantity: a.quantity }));

  const rows: HoldingRow[] = list.map((a) => {
    const value = assetValue(a);
    const cost = assetCost(a);
    const series = a.type === "cash" ? [] : buildAssetPriceSeries(byAsset.get(a.id) ?? [], a.currentPrice, t);
    const daily = latestDailyPriceChange(series);
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      symbol: a.symbol,
      cryptoCategory: a.cryptoCategory,
      quantity: a.quantity,
      avgCost: a.avgCost,
      currentPrice: a.currentPrice,
      dailyChangePct: daily?.changePct ?? null,
      value,
      cost,
      pnl: value - cost,
      pnlPct: cost > 0 ? (value - cost) / cost : 0,
      weight: totals.totalValue > 0 ? value / totals.totalValue : 0,
    };
  });

  const points: Point[] = snaps.map((s) => ({ date: s.date, value: s.totalValue, cost: s.costBasis }));
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
      <AutoDailySnapshot stale={stalePrices} currentDate={t} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PortfolioValueHeader
          totalValue={totals.totalValue}
          rows={rows}
          prev={prev}
          change={change}
        />
        <div className="flex gap-2">
          <RefreshPricesButton />
          <AddAssetDialog cashAccounts={cashAccounts} />
        </div>
      </div>

      <DashboardLayout
        initialOrder={dashboardOrder}
        initialStatsOrder={statOrder}
        initialStatsLabels={statLabels}
        statsCards={{
          cash: {
            value: money(totals.cashValue),
            hint: `${pct(totals.totalValue ? totals.cashValue / totals.totalValue : 0, false)} of portfolio`,
          },
          invested: {
            value: money(invested),
            hint: `${list.filter((a) => a.type !== "cash").length} positions`,
          },
          unrealized: {
            value: money(totals.unrealized, { sign: true }),
            valueClass: pnlColor(totals.unrealized),
            hint: pct(unrealizedPct),
            hintClass: pnlColor(totals.unrealized),
          },
          realized: {
            value: money(totals.realized, { sign: true }),
            valueClass: pnlColor(totals.realized),
            hint: "From sells, dividends & interest",
          },
        }}
        blocks={{
          holdings: (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 pt-5">
                <h2 className="font-semibold text-slate-900">Holdings</h2>
              </div>
              <HoldingsTable rows={rows} />
            </section>
          ),
          history: (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold text-slate-900">Value history</h2>
              <HistoryChart points={points} />
            </section>
          ),
          allocation: (
            <section className="card min-w-0 p-4 sm:p-5">
              <h2 className="mb-4 font-semibold text-slate-900">Allocation</h2>
              <Donut slices={slices} centerLabel="Total" />
            </section>
          ),
          activity: (
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
          ),
        }}
      />
    </div>
  );
}
