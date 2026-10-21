import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { deleteAsset, deleteTransaction } from "@/app/actions";
import { EditAssetButton, PriceForm, TransactionForm } from "@/components/AssetForms";
import { ConfirmSubmit } from "@/components/ui";
import CryptoLogo from "@/components/CryptoLogo";
import { KIND_META, TYPE_META, fmtDate, money, pct, pnlColor, qty } from "@/lib/format";
import { assetCost, assetValue, ensureSchema, getAllAssets, getAssetTransactions } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) notFound();
  await ensureSchema();
  const [asset] = await db.select().from(assets).where(eq(assets.id, id));
  if (!asset) notFound();

  const [txs, all] = await Promise.all([getAssetTransactions(id), getAllAssets()]);
  const cashAccounts = all
    .filter((a) => a.type === "cash" && a.id !== id)
    .map((a) => ({ id: a.id, name: a.name, quantity: a.quantity }));
  const portfolioTotal = all.reduce((s, a) => s + assetValue(a), 0);

  const isCash = asset.type === "cash";
  const value = assetValue(asset);
  const cost = assetCost(asset);
  const pnl = value - cost;
  const meta = TYPE_META[asset.type];

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-800">
        ← Back to dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
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
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${meta.badge}`}>
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
          <EditAssetButton asset={{ id: asset.id, name: asset.name, symbol: asset.symbol, notes: asset.notes }} />
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
                  updated {asset.priceUpdatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
              <p className="mb-3 text-2xl font-semibold tabular-nums">{money(asset.currentPrice)}</p>
              <PriceForm assetId={asset.id} currentPrice={asset.currentPrice} />
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

        <section className="card overflow-hidden lg:col-span-2">
          <h2 className="px-5 pt-5 font-semibold">Transaction history</h2>
          <div className="overflow-x-auto">
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
        </section>
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
      <p className={`mt-2 truncate text-xl font-semibold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${subCls}`}>{sub}</p>}
    </div>
  );
}
