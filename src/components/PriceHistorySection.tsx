"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AssetType } from "@/lib/constants";
import { TYPE_META, fmtDate, money, pct, pnlColor } from "@/lib/format";
import { computeDailyPriceRows, type PricePoint } from "@/lib/price-history";
import { PriceHistoryChart } from "./Charts";
import CryptoLogo from "./CryptoLogo";

const DEFAULT_VISIBLE_ROWS = 8;

export default function PriceHistorySection({
  points,
  avgCost = 0,
}: {
  points: PricePoint[];
  avgCost?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const dailyRows = useMemo(() => computeDailyPriceRows(points), [points]);
  const visibleRows = expanded ? dailyRows : dailyRows.slice(0, DEFAULT_VISIBLE_ROWS);

  return (
    <div className="space-y-5">
      <PriceHistoryChart points={points} avgCost={avgCost} />

      {dailyRows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-100">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Daily snapshot prices ({dailyRows.length})
            </span>
            {dailyRows.length > DEFAULT_VISIBLE_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                {expanded ? "Show recent" : `Show all ${dailyRows.length}`}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Snapshot price</th>
                  <th className="px-4 py-2 text-right font-medium">Daily change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((row) => (
                  <tr key={row.date} className="transition hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(row.date)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-slate-900">
                      {money(row.price)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${
                        row.change !== null ? pnlColor(row.change) : "text-slate-400"
                      }`}
                    >
                      {row.change !== null && row.changePct !== null ? (
                        <span>
                          <span className="font-medium">{money(row.change, { sign: true })}</span>
                          <span className="ml-1.5 text-xs">({pct(row.changePct)})</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export type AssetPriceHistoryItem = {
  id: number;
  type: AssetType;
  name: string;
  symbol: string;
  avgCost: number;
  currentPrice: number;
  points: PricePoint[];
};

export function PortfolioPriceHistory({ assets }: { assets: AssetPriceHistoryItem[] }) {
  const [selectedId, setSelectedId] = useState<number>(assets[0]?.id ?? 0);

  if (assets.length === 0) return null;

  const active = assets.find((a) => a.id === selectedId) ?? assets[0];

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Price history</h2>
          <p className="text-xs text-slate-500">Tracked from daily snapshot prices saved automatically each day.</p>
        </div>
        <Link href={`/assets/${active.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
          Open {active.symbol || active.name} →
        </Link>
      </div>

      {assets.length > 1 && (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Select asset price history">
          {assets.map((item) => {
            const isSelected = item.id === active.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedId(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                  isSelected
                    ? "border-indigo-300 bg-indigo-50/60 text-slate-900 ring-2 ring-indigo-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.type === "crypto" ? (
                  <CryptoLogo symbol={item.symbol} name={item.name} className="h-6 w-6 rounded-lg" />
                ) : (
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white"
                    style={{ background: TYPE_META[item.type].color }}
                  >
                    {(item.symbol || item.name).slice(0, 3).toUpperCase()}
                  </span>
                )}
                <span className="font-semibold">{item.symbol || item.name}</span>
                <span className="text-xs tabular-nums text-slate-500">{money(item.currentPrice)}</span>
              </button>
            );
          })}
        </div>
      )}

      <PriceHistorySection key={active.id} points={active.points} avgCost={active.avgCost} />
    </section>
  );
}
