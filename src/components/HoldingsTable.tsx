"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AssetType } from "@/lib/constants";
import { TYPE_META, money, pct, pnlColor, qty } from "@/lib/format";
import {
  HOLDING_FILTERS,
  getSelectedHoldingFilter,
  matchesHoldingFilter,
  setSelectedHoldingFilter,
  subscribeHoldingFilter,
  type HoldingFilter,
} from "@/lib/holdings-filter";
import CryptoLogo from "./CryptoLogo";

export type HoldingRow = {
  id: number;
  type: AssetType;
  name: string;
  symbol: string;
  cryptoCategory: "stablecoin" | "volatile";
  wallet?: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  dailyChangePct?: number | null;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  weight: number;
};

type SortKey = "name" | "value" | "pnl" | "pnlPct" | "weight";

/** Mobile has no table header, so sorting is offered as a select instead. */
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "value:-1", label: "Value · high to low" },
  { value: "value:1", label: "Value · low to high" },
  { value: "name:1", label: "Name · A to Z" },
  { value: "name:-1", label: "Name · Z to A" },
  { value: "pnl:-1", label: "P/L · best first" },
  { value: "pnl:1", label: "P/L · worst first" },
  { value: "pnlPct:-1", label: "P/L % · best first" },
  { value: "weight:-1", label: "Weight · largest first" },
];

export default function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  const filter = useSyncExternalStore<HoldingFilter>(
    subscribeHoldingFilter,
    getSelectedHoldingFilter,
    () => "all",
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });

  useEffect(() => {
    return () => {
      setSelectedHoldingFilter("all");
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, stablecoin: 0, volatile: 0 };
    for (const r of rows) {
      c[r.type] = (c[r.type] ?? 0) + 1;
      if (r.type === "crypto") c[r.cryptoCategory] = (c[r.cryptoCategory] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => matchesHoldingFilter(r, filter))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q))
      .sort((a, b) => {
        const k = sort.key;
        const av = a[k];
        const bv = b[k];
        if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
        return ((av as number) - (bv as number)) * sort.dir;
      });
  }, [rows, filter, query, sort]);

  const th = (key: SortKey, label: string, align = "text-right") => (
    <th className={`px-4 py-3 font-medium ${align}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-slate-900"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}
      >
        {label}
        <span className="text-[10px]">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {HOLDING_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedHoldingFilter(value)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
              <span className={`ml-1.5 text-xs ${filter === value ? "opacity-70" : "text-slate-400"}`}>
                {counts[value] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input min-w-0 sm:max-w-56"
            placeholder="Search name or symbol…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search holdings"
          />
          <label className="flex items-center gap-2 text-xs text-slate-500 md:hidden">
            <span className="shrink-0">Sort</span>
            <select
              className="input min-w-0 py-1.5 text-sm"
              value={`${sort.key}:${sort.dir}`}
              onChange={(event) => {
                const [key, dir] = event.target.value.split(":");
                setSort({ key: key as SortKey, dir: dir === "1" ? 1 : -1 });
              }}
              aria-label="Sort holdings"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {th("name", "Asset", "text-left")}
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Avg cost</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              {th("value", "Value")}
              {th("pnl", "P/L")}
              {th("weight", "Weight")}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => {
              const isCash = r.type === "cash";
              return (
                <tr key={r.id} className="group transition hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <Link href={`/assets/${r.id}`} className="flex items-center gap-3">
                      {r.type === "crypto" ? (
                        <CryptoLogo symbol={r.symbol} name={r.name} wallet={r.wallet} />
                      ) : (
                        <span
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold text-white"
                          style={{ background: TYPE_META[r.type].color }}
                        >
                          {(r.symbol || r.name).slice(0, 4).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 group-hover:text-indigo-600">
                          {r.name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {r.symbol && r.symbol !== r.name ? `${r.symbol} · ` : ""}
                          {r.type === "crypto" ? (r.cryptoCategory === "stablecoin" ? "Crypto · Stablecoin" : "Crypto · Volatile") : TYPE_META[r.type].label}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{isCash ? "—" : qty(r.quantity)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{isCash ? "—" : money(r.avgCost)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {isCash ? (
                      "—"
                    ) : (
                      <>
                        <div>{money(r.currentPrice)}</div>
                        {r.dailyChangePct !== null && r.dailyChangePct !== undefined && (
                          <div className={`text-xs ${pnlColor(r.dailyChangePct)}`}>{pct(r.dailyChangePct)}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money(r.value)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(r.pnl)}`}>
                    {isCash ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <>
                        <div className="font-medium">{money(r.pnl, { sign: true })}</div>
                        <div className="text-xs">{r.cost > 0 ? pct(r.pnlPct) : "—"}</div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, r.weight * 100)}%`, background: TYPE_META[r.type].color }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums text-slate-600">{(r.weight * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                  No holdings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per holding instead of a 760px-wide table. */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {shown.map((r) => {
          const isCash = r.type === "cash";
          const subtitle = r.type === "crypto"
            ? r.cryptoCategory === "stablecoin"
              ? "Crypto · Stablecoin"
              : "Crypto · Volatile"
            : TYPE_META[r.type].label;
          return (
            <li key={r.id} className="px-4 py-3">
              <Link href={`/assets/${r.id}`} className="flex items-start gap-3">
                {r.type === "crypto" ? (
                  <CryptoLogo symbol={r.symbol} name={r.name} wallet={r.wallet} />
                ) : (
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold text-white"
                    style={{ background: TYPE_META[r.type].color }}
                  >
                    {(r.symbol || r.name).slice(0, 4).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{r.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {r.symbol && r.symbol !== r.name ? `${r.symbol} · ` : ""}
                    {subtitle}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums text-slate-900">{money(r.value)}</span>
                  <span className={`block text-xs tabular-nums ${isCash ? "text-slate-400" : pnlColor(r.pnl)}`}>
                    {isCash ? "cash" : `${money(r.pnl, { sign: true })} · ${r.cost > 0 ? pct(r.pnlPct) : "—"}`}
                  </span>
                </span>
              </Link>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="min-w-0 truncate tabular-nums">
                  {isCash ? (
                    "Balance"
                  ) : (
                    <>
                      {qty(r.quantity)} × {money(r.currentPrice)}
                      {r.dailyChangePct !== null && r.dailyChangePct !== undefined && (
                        <span className={`ml-1 ${pnlColor(r.dailyChangePct)}`}>{pct(r.dailyChangePct)}</span>
                      )}
                    </>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(100, r.weight * 100)}%`, background: TYPE_META[r.type].color }}
                    />
                  </span>
                  <span className="w-10 text-right tabular-nums text-slate-600">{(r.weight * 100).toFixed(1)}%</span>
                </span>
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-12 text-center text-sm text-slate-400">No holdings match.</li>}
      </ul>
    </div>
  );
}
