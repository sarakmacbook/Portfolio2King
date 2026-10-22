import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import { TX_KINDS, type TxKind } from "@/lib/constants";
import { KIND_META, TYPE_META, fmtDate, money, qty } from "@/lib/format";
import { getRecentActivity } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const { kind } = await searchParams;
  const active = TX_KINDS.includes(kind as TxKind) ? (kind as TxKind) : null;
  const all = await getRecentActivity(500);
  const rows = active ? all.filter((r) => r.tx.kind === active) : all;

  const inflow = rows
    .filter((r) => ["sell", "deposit", "dividend"].includes(r.tx.kind))
    .reduce((s, r) => s + r.tx.quantity * r.tx.price, 0);
  const outflow = rows
    .filter((r) => ["buy", "withdraw"].includes(r.tx.kind))
    .reduce((s, r) => s + r.tx.quantity * r.tx.price, 0);
  const fees = rows.reduce((s, r) => s + r.tx.fee, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-slate-500">Every transaction across all your accounts and assets.</p>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Buys / withdrawals</p>
            <p className="font-semibold tabular-nums">{money(outflow)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Sells / deposits / income</p>
            <p className="font-semibold tabular-nums">{money(inflow)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Fees</p>
            <p className="font-semibold tabular-nums">{money(fees)}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        <FilterLink href="/activity" active={!active} label="All" />
        {TX_KINDS.map((k) => (
          <FilterLink key={k} href={`/activity?kind=${k}`} active={active === k} label={KIND_META[k].label} />
        ))}
      </div>

      <section className="card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Asset</th>
                <th className="px-3 py-3 text-right font-medium">Qty</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                <th className="px-3 py-3 text-right font-medium">Fee</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ tx, asset }) => {
                const cashLike = asset.type === "cash" || tx.kind === "dividend";
                return (
                  <tr key={tx.id} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                      {fmtDate(tx.date)}
                      {tx.note && <div className="max-w-[200px] truncate text-xs text-slate-400">{tx.note}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${KIND_META[tx.kind].badge}`}>
                        {KIND_META[tx.kind].label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/assets/${asset.id}`} className="flex items-center gap-2 hover:text-indigo-600">
                        <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[asset.type].color }} />
                        <span className="font-medium">{asset.symbol || asset.name}</span>
                        {asset.symbol && <span className="truncate text-slate-400">{asset.name}</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{cashLike ? "—" : qty(tx.quantity)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{cashLike ? "—" : money(tx.price)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-400">{tx.fee ? money(tx.fee) : "—"}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{money(tx.quantity * tx.price)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center text-slate-400">
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Phones: transaction cards instead of a wide table. */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {rows.map(({ tx, asset }) => {
            const cashLike = asset.type === "cash" || tx.kind === "dividend";
            return (
              <li key={tx.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/assets/${asset.id}`} className="flex items-center gap-2 font-medium text-slate-900">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_META[asset.type].color }} />
                      <span className="truncate">{asset.symbol || asset.name}</span>
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${KIND_META[tx.kind].badge}`}>
                        {KIND_META[tx.kind].label}
                      </span>
                      <span>{fmtDate(tx.date)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-slate-900">{money(tx.quantity * tx.price)}</p>
                    <p className="text-xs tabular-nums text-slate-500">
                      {cashLike ? "cash" : `${qty(tx.quantity)} × ${money(tx.price)}`}
                      {tx.fee ? ` · fee ${money(tx.fee)}` : ""}
                    </p>
                  </div>
                </div>
                {tx.note && <p className="mt-1 truncate text-xs text-slate-400">{tx.note}</p>}
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-4 py-14 text-center text-sm text-slate-400">No transactions found.</li>}
        </ul>
      </section>
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}
