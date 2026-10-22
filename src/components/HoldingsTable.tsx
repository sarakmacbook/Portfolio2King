"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { resetAssetOrder, saveAssetOrder, type ActionState } from "@/app/actions";
import type { AssetType } from "@/lib/constants";
import { moveId, moveItem } from "@/lib/asset-order";
import { TYPE_META, money, pct, pnlColor, qty } from "@/lib/format";
import CryptoLogo from "./CryptoLogo";

export type HoldingRow = {
  id: number;
  type: AssetType;
  name: string;
  symbol: string;
  cryptoCategory: "stablecoin" | "volatile";
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

type SortKey = "manual" | "name" | "value" | "pnl" | "pnlPct" | "weight";
type HoldingFilter = AssetType | "all" | "stablecoin" | "volatile";

const FILTERS: Array<{ value: HoldingFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "cash", label: "Cash" },
  { value: "stock", label: "Stocks" },
  { value: "stablecoin", label: "Stablecoins" },
  { value: "volatile", label: "Volatile crypto" },
  { value: "other", label: "Other" },
];

export default function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  const [filter, setFilter] = useState<HoldingFilter>("all");
  const [query, setQuery] = useState("");
  // "manual" follows the saved dashboard order (see Arrange mode).
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "manual", dir: 1 });

  // Arrange mode: drag rows (or use the arrow buttons) then Save.
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; after: boolean } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const savedOrder = useRef<number[]>([]);

  function startArranging() {
    const ids = rows.map((row) => row.id);
    savedOrder.current = ids;
    setOrder(ids);
    setFilter("all");
    setQuery("");
    setNotice(null);
    setArranging(true);
  }

  function cancelArranging() {
    setOrder(savedOrder.current);
    setDraggingId(null);
    setDropTarget(null);
    setArranging(false);
  }

  function moveRow(id: number, delta: number) {
    const index = order.indexOf(id);
    if (index < 0) return;
    const target = Math.max(0, Math.min(order.length - 1, index + delta));
    if (target === index) return;
    setOrder((current) => moveItem(current, index, target));
    const name = rows.find((row) => row.id === id)?.name ?? "Holding";
    setAnnouncement(`${name} moved to position ${target + 1} of ${order.length}.`);
  }

  function handleDrop() {
    if (draggingId === null || !dropTarget) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }
    const next = moveId(order, draggingId, dropTarget.id, dropTarget.after);
    setOrder(next);
    const position = next.indexOf(draggingId) + 1;
    const name = rows.find((row) => row.id === draggingId)?.name ?? "Holding";
    setAnnouncement(`${name} moved to position ${position} of ${next.length}.`);
    setDraggingId(null);
    setDropTarget(null);
  }

  function saveOrder() {
    const payload = JSON.stringify(order);
    startSaving(async () => {
      const fd = new FormData();
      fd.set("order", payload);
      const result: ActionState = await saveAssetOrder({}, fd);
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      savedOrder.current = order;
      setArranging(false);
      setNotice({ kind: "ok", text: result.message ?? "Order saved." });
    });
  }

  function resetOrder() {
    startSaving(async () => {
      const result = await resetAssetOrder({}, new FormData());
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setOrder(rows.map((row) => row.id));
      savedOrder.current = rows.map((row) => row.id);
      setArranging(false);
      setNotice({ kind: "ok", text: result.message ?? "Order reset to the default." });
    });
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, stablecoin: 0, volatile: 0 };
    for (const r of rows) {
      c[r.type] = (c[r.type] ?? 0) + 1;
      if (r.type === "crypto") c[r.cryptoCategory] = (c[r.cryptoCategory] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const orderedRows = useMemo(() => {
    if (!arranging) return rows;
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    return order
      .map((id) => byId.get(id))
      .filter((row): row is HoldingRow => Boolean(row));
  }, [arranging, order, rows]);

  const shown = useMemo(() => {
    // While arranging, show exactly the working order — filters and column
    // sorting would make drag positions jump around.
    if (arranging) return orderedRows;
    const q = query.trim().toLowerCase();
    return orderedRows
      .filter((r) => {
        if (filter === "all") return true;
        if (filter === "stablecoin" || filter === "volatile") {
          return r.type === "crypto" && r.cryptoCategory === filter;
        }
        return r.type === filter;
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q))
      .sort((a, b) => {
        const k = sort.key;
        if (k === "manual") return 0;
        const av = a[k];
        const bv = b[k];
        if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
        return ((av as number) - (bv as number)) * sort.dir;
      });
  }, [arranging, orderedRows, filter, query, sort]);

  const th = (key: SortKey, label: string, align = "text-right") => (
    <th className={`px-4 py-3 font-medium ${align}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400"
        disabled={arranging}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}
      >
        {label}
        <span className="text-[10px]">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {arranging && (
        <div className="flex flex-col gap-3 border-b border-indigo-100 bg-indigo-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-indigo-900">Arrange holdings</p>
            <p className="text-xs text-indigo-700/80">
              Drag rows, or use the ↑ ↓ buttons (works on touch screens). Nothing changes until you save.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={cancelArranging} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-ghost" onClick={resetOrder} disabled={saving}>
              Reset to default
            </button>
            <button type="button" className="btn-primary" onClick={saveOrder} disabled={saving}>
              {saving ? "Saving…" : "Save order"}
            </button>
          </div>
        </div>
      )}

      {!arranging && notice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${
            notice.kind === "ok"
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : "border-rose-100 bg-rose-50 text-rose-700"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className={`flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between ${arranging ? "hidden" : ""}`}>
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
              <span className={`ml-1.5 text-xs ${filter === value ? "text-slate-300" : "text-slate-400"}`}>
                {counts[value] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input sm:max-w-56"
            placeholder="Search name or symbol…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {sort.key !== "manual" && (
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={() => setSort({ key: "manual", dir: 1 })}
              title="Show holdings in your saved order"
            >
              ↺ Custom order
            </button>
          )}
          <button
            type="button"
            className="btn-ghost shrink-0"
            onClick={startArranging}
            disabled={rows.length < 2}
            title={rows.length < 2 ? "Add at least two holdings to reorder them" : "Reorder holdings"}
          >
            ⇅ Arrange
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {arranging && <th className="w-24 px-3 py-3 font-medium">Order</th>}
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
                <tr
                  key={r.id}
                  draggable={arranging}
                  onDragStart={(event) => {
                    if (!arranging) return;
                    setDraggingId(r.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(r.id));
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(event) => {
                    if (!arranging || draggingId === null || draggingId === r.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const after = event.clientY - rect.top > rect.height / 2;
                    setDropTarget((current) =>
                      current?.id === r.id && current.after === after ? current : { id: r.id, after },
                    );
                  }}
                  onDrop={(event) => {
                    if (!arranging) return;
                    event.preventDefault();
                    handleDrop();
                  }}
                  className={`group transition ${
                    draggingId === r.id
                      ? "opacity-40"
                      : dropTarget?.id === r.id
                        ? `bg-indigo-50/60 ${dropTarget.after ? "shadow-[inset_0_-2px_0_0_#6366f1]" : "shadow-[inset_0_2px_0_0_#6366f1]"}`
                        : "hover:bg-slate-50/80"
                  } ${arranging ? "cursor-grab active:cursor-grabbing" : ""}`}
                >
                  {arranging && (
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center gap-1">
                        <span
                          className="grid h-8 w-5 place-items-center text-slate-400"
                          aria-hidden="true"
                          title="Drag to reorder"
                        >
                          <svg viewBox="0 0 10 16" className="h-4 w-2.5 fill-current">
                            <circle cx="2" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" />
                            <circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
                            <circle cx="2" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" />
                          </svg>
                        </span>
                        <span className="flex flex-col">
                          <button
                            type="button"
                            className="grid h-4 w-6 place-items-center rounded text-[10px] text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30"
                            onClick={() => moveRow(r.id, -1)}
                            disabled={order.indexOf(r.id) === 0}
                            aria-label={`Move ${r.name} up`}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="grid h-4 w-6 place-items-center rounded text-[10px] text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30"
                            onClick={() => moveRow(r.id, 1)}
                            disabled={order.indexOf(r.id) === order.length - 1}
                            aria-label={`Move ${r.name} down`}
                          >
                            ▼
                          </button>
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={`/assets/${r.id}`} className="flex items-center gap-3">
                      {r.type === "crypto" ? (
                        <CryptoLogo symbol={r.symbol} name={r.name} />
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
                <td colSpan={arranging ? 8 : 7} className="px-4 py-12 text-center text-sm text-slate-400">
                  No holdings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
