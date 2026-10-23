import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { deleteAsset, deleteTransaction } from "@/app/actions";
import AutoDailySnapshot from "@/components/AutoDailySnapshot";
import { EditAssetButton, PriceForm, TransactionForm } from "@/components/AssetForms";
import CryptoLogo from "@/components/CryptoLogo";
import PriceHistorySection from "@/components/PriceHistorySection";
import { ConfirmSubmit } from "@/components/ui";
import { KIND_META, TYPE_META, fmtDate, money, pct, pnlColor, qty } from "@/lib/format";
import {
  assetCost,
  assetValue,
  ensureSchema,
  getAllAssets,
  getAssetPriceSnapshots,
  getAssetTransactions,
  localDateString,
  today,
} from "@/lib/portfolio";
import { buildAssetPriceSeries, latestDailyPriceChange } from "@/lib/price-history";
import { describePriceSource } from "@/lib/market-prices";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) notFound();
  await ensureSchema();
  const [asset] = await db.select().from(assets).where(eq(assets.id, id));
  if (!asset) notFound();

  const all = await getAllAssets();
  const [txs, priceSnaps] = await Promise.all([
    getAssetTransactions(id),
    getAssetPriceSnapshots(id),
  ]);
  const t = today();
  const stalePrices = all.some(
    (a) =>
      (a.type === "crypto" || a.type === "stock") &&
      a.symbol.trim() !== "" &&
      localDateString(a.priceUpdatedAt) < t,
  );
  const cashAccounts = all
    .filter((a) => a.type === "cash" && a.id !== id)
    .map((a) => ({ id: a.id, name: a.name, quantity: a.quantity }));
  const portfolioTotal = all.reduce((s, a) => s + assetValue(a), 0);

  const isCash = asset.type === "cash";
  const value = assetValue(asset);
  const cost = assetCost(asset);
  const pnl = value - cost;
  const meta = TYPE_META[asset.type];
  const priceSeries = isCash ? [] : buildAssetPriceSeries(priceSnaps, asset.currentPrice, t);
  const dailyChange = latestDailyPriceChange(priceSeries);

  return (
    <div className="space-y-6">
      <AutoDailySnapshot stale={stalePrices} currentDate={t} />
      <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-800">
        ← Back to dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {asset.type === "crypto" ? (
            <CryptoLogo symbol={asset.symbol} name={asset.name} className="h-14 w-14 rounded-2xl" />
          ) : (
            <span
              className="grid h-14 w-14 place-items-center rounded-2xl text-sm font-bold text-white shadow-sm"
              style={{ background: meta.color }}
            >
              {(asset.symbol || asset.name).slice(0, 4).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">{asset.name}</h1>
              <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${meta.badge}`}>
                {meta.icon} {meta.label.replace(/s$/, "")}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              {asset.symbol && <span className="font-medium">{asset.symbol} · </span>}
              {pct(portfolioTotal > 0 ? value / portfolioTotal : 0, false)} of portfolio
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <EditAssetButton
            asset={{
              id: asset.id,
              name: asset.name,
              symbol: asset.symbol,
              notes: asset.notes,
              type: asset.type,
              cryptoCategory: asset.cryptoCategory,
              priceSource: asset.priceSource,
            }}
          />
          <form action={deleteAsset}>
            <input type="hidden" name="id" value={asset.id} />
            <ConfirmSubmit message={`Delete "${asset.name}" and all of its transactions? This cannot be undone.`}>
              Delete
            </ConfirmSubmit>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={isCash ? "Balance" : "Market value"} value={money(value)} />
        {isCash ? (
          <>
            <Stat label="Transactions" value={String(txs.length)} />
            <Stat label="Interest / income" value={money(asset.realizedPnl, { sign: true })} cls={pnlColor(asset.realizedPnl)} />
            <Stat label="Last activity" value={txs.length ? fmtDate(txs[txs.length - 1].date) : "—"} />
          </>
        ) : (
          <>
            <Stat label="Holdings" value={`${qty(asset.quantity)} ${asset.symbol}`} sub={`Avg cost ${money(asset.avgCost)}`} />
            <Stat
              label="Unrealized P/L"
              value={money(pnl, { sign: true })}
              cls={pnlColor(pnl)}
              sub={cost > 0 ? pct(pnl / cost) : "—"}
              subCls={pnlColor(pnl)}
            />
            <Stat
              label="Realized P/L + income"
              value={money(asset.realizedPnl, { sign: true })}
              cls={pnlColor(asset.realizedPnl)}
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          {!isCash && (
            <section className="card p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-semibold">Current price</h2>
                <span className="text-xs text-slate-400">
                  {asset.type === "crypto" ? `${describePriceSource(asset.priceSource)} · ` : ""}
                  updated {asset.priceUpdatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
              <p className="text-2xl font-semibold tabular-nums">{money(asset.currentPrice)}</p>
              {dailyChange && (
                <p className={`mt-1 text-xs font-medium tabular-nums ${pnlColor(dailyChange.change)}`}>
                  {money(dailyChange.change, { sign: true })} ({pct(dailyChange.changePct)}) since{" "}
                  {fmtDate(dailyChange.prevDate)}
                </p>
              )}
              <div className="mt-3">
                <PriceForm assetId={asset.id} currentPrice={asset.currentPrice} />
              </div>
            </section>
          )}
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">New transaction</h2>
            <TransactionForm
              assetId={asset.id}
              assetType={asset.type}
              currentPrice={asset.currentPrice}
              available={asset.quantity}
              cashAccounts={cashAccounts}
            />
          </section>
          {asset.notes && (
            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Notes</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{asset.notes}</p>
            </section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          {!isCash && (
            <section className="card p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">Price history</h2>
                <span className="text-xs text-slate-400">Daily snapshot prices</span>
              </div>
              <PriceHistorySection points={priceSeries} avgCost={asset.avgCost} />
            </section>
          )}

          <section className="card overflow-hidden">
            <h2 className="px-5 pt-5 font-semibold">Transaction history</h2>
            <div className="hidden overflow-x-auto sm:block">
              <table className="mt-3 w-full min-w-[560px] text-sm">
                <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 text-right font-medium">{isCash ? "Amount" : "Qty"}</th>
                    {!isCash && <th className="px-3 py-2.5 text-right font-medium">Price</th>}
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...txs].reverse().map((t) => {
                    const income = t.kind === "dividend";
                    return (
                      <tr key={t.id} className="group">
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                          {fmtDate(t.date)}
                          {t.note && <div className="max-w-[180px] truncate text-xs text-slate-400">{t.note}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${KIND_META[t.kind].badge}`}>
                            {KIND_META[t.kind].label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {isCash || income ? money(t.quantity) : qty(t.quantity)}
                        </td>
                        {!isCash && (
                          <td className="px-3 py-3 text-right tabular-nums text-slate-600">{income ? "—" : money(t.price)}</td>
                        )}
                        <td className="px-3 py-3 text-right font-medium tabular-nums">
                          {money(t.quantity * t.price)}
                          {t.fee > 0 && <div className="text-xs font-normal text-slate-400">fee {money(t.fee)}</div>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <form action={deleteTransaction}>
                            <input type="hidden" name="id" value={t.id} />
                            <ConfirmSubmit
                              message="Delete this transaction? Holdings will be recalculated. (Linked cash entries are not removed automatically.)"
                              className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                            >
                              Delete
                            </ConfirmSubmit>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                  {txs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                        No transactions yet. Record your first one on the left.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per transaction, with the delete action inline. */}
            <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 sm:hidden">
              {[...txs].reverse().map((t) => {
                const income = t.kind === "dividend";
                return (
                  <li key={t.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${KIND_META[t.kind].badge}`}>
                            {KIND_META[t.kind].label}
                          </span>
                          <span className="text-xs text-slate-500">{fmtDate(t.date)}</span>
                        </div>
                        <p className="mt-1 text-xs tabular-nums text-slate-500">
                          {isCash || income ? money(t.quantity) : `${qty(t.quantity)} × ${money(t.price)}`}
                          {t.fee > 0 ? ` · fee ${money(t.fee)}` : ""}
                        </p>
                        {t.note && <p className="mt-1 truncate text-xs text-slate-400">{t.note}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-medium tabular-nums text-slate-900">{money(t.quantity * t.price)}</span>
                        <form action={deleteTransaction}>
                          <input type="hidden" name="id" value={t.id} />
                          <ConfirmSubmit
                            message="Delete this transaction? Holdings will be recalculated. (Linked cash entries are not removed automatically.)"
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            Delete
                          </ConfirmSubmit>
                        </form>
                      </div>
                    </div>
                  </li>
                );
              })}
              {txs.length === 0 && (
                <li className="px-5 py-12 text-center text-slate-400">No transactions yet. Record your first one above.</li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  cls = "text-slate-900",
  subCls = "text-slate-500",
}: {
  label: string;
  value: string;
  sub?: string;
  cls?: string;
  subCls?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 truncate text-lg font-semibold tabular-nums sm:text-xl ${cls}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${subCls}`}>{sub}</p>}
    </div>
  );
}
