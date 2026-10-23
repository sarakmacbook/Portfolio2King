"use client";

import { useSyncExternalStore } from "react";
import { fmtDate, money, pct, pnlColor } from "@/lib/format";
import {
  categoryFilterLabel,
  categoryTotalValue,
  getSelectedHoldingFilter,
  subscribeHoldingFilter,
  type FilterableHolding,
  type HoldingFilter,
} from "@/lib/holdings-filter";

export default function PortfolioValueHeader({
  totalValue,
  rows,
  prev,
  change,
}: {
  totalValue: number;
  rows: FilterableHolding[];
  prev: { date: string; value: number } | null;
  change: number;
}) {
  const filter = useSyncExternalStore<HoldingFilter>(
    subscribeHoldingFilter,
    getSelectedHoldingFilter,
    () => "all",
  );

  const activeValue =
    filter === "all" ? totalValue : categoryTotalValue(rows, filter);

  return (
    <div>
      <p className="text-sm font-medium text-slate-500">
        Total portfolio value{filter !== "all" ? ` · ${categoryFilterLabel(filter)}` : ""}
      </p>
      <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-4xl">
        {money(activeValue)}
      </h1>
      {filter === "all" ? (
        prev && (
          <p className={`mt-1 text-sm font-medium ${pnlColor(change)}`}>
            {money(change, { sign: true })} ({pct(prev.value > 0 ? change / prev.value : 0)}) since{" "}
            {fmtDate(prev.date)}
          </p>
        )
      ) : (
        <p className="mt-1 text-sm font-medium text-slate-500">
          {pct(totalValue > 0 ? activeValue / totalValue : 0, false)} of total portfolio ({money(totalValue)})
        </p>
      )}
    </div>
  );
}
