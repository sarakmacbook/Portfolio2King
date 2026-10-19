"use client";

import { useActionState, useEffect, useState } from "react";
import { bulkUpdatePrices, type ActionState } from "@/app/actions";
import type { AssetType } from "@/lib/constants";
import { TYPE_META, money, pct, pnlColor, qty } from "@/lib/format";
import { ErrorNote, SubmitButton } from "./ui";

export type PriceRow = {
  id: number;
  type: AssetType;
  name: string;
  symbol: string;
  quantity: number;
  currentPrice: number;
  updated: string;
};

export default function BulkPriceForm({ rows }: { rows: PriceRow[] }) {
  const [state, action] = useActionState<ActionState, FormData>(bulkUpdatePrices, {});
  const [values, setValues] = useState<Record<number, string>>({});

  useEffect(() => {
    if (state.ok) setValues({});
  }, [state.ok, state.ts]);

  const changes = rows.filter((r) => {
    const v = values[r.id];
    return v !== undefined && v.trim() !== "" && Number(v) !== r.currentPrice;
  });
  const delta = changes.reduce((s, r) => s + (Number(values[r.id]) - r.currentPrice) * r.quantity, 0);

  return (
    <form action={action}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-3 py-3 text-right font-medium">Holdings</th>
              <th className="px-3 py-3 text-right font-medium">Current price</th>
              <th className="px-3 py-3 font-medium">New price</th>
              <th className="px-5 py-3 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const v = values[r.id] ?? "";
              const n = Number(v);
              const changed = v.trim() !== "" && isFinite(n) && n !== r.currentPrice;
              const chg = r.currentPrice > 0 ? (n - r.currentPrice) / r.currentPrice : 0;
              return (
                <tr key={r.id} className={changed ? "bg-indigo-50/40" : ""}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[r.type].color }} />
                      <span className="font-medium text-slate-900">{r.symbol || r.name}</span>
                      {r.symbol && <span className="truncate text-slate-500">{r.name}</span>}
                    </div>
                    <div className="ml-4 text-xs text-slate-400">updated {r.updated}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{qty(r.quantity)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-900">{money(r.currentPrice)}</td>
                  <td className="px-3 py-3">
                    <input
                      name={`price_${r.id}`}
                      inputMode="decimal"
                      className="input max-w-40"
                      placeholder={String(r.currentPrice)}
                      value={v}
                      onChange={(e) => setValues((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${changed ? pnlColor(chg) : "text-slate-300"}`}>
                    {changed ? (
                      <>
                        <div className="font-medium">{pct(chg)}</div>
                        <div className="text-xs">{money((n - r.currentPrice) * r.quantity, { sign: true })}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">
          {changes.length ? (
            <>
              {changes.length} change{changes.length > 1 ? "s" : ""} · portfolio impact{" "}
              <span className={`font-semibold ${pnlColor(delta)}`}>{money(delta, { sign: true })}</span>
            </>
          ) : state.ok ? (
            <span className="text-emerald-600">Prices saved ✓</span>
          ) : (
            "Enter new prices — leave blank to keep the current value."
          )}
        </div>
        <div className="flex items-center gap-3">
          <ErrorNote error={state.error} />
          <SubmitButton>Save prices</SubmitButton>
        </div>
      </div>
    </form>
  );
}
