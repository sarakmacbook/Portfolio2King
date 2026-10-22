"use client";

import Link from "next/link";
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { resetAssetOrder, saveAssetOrder, type ActionState } from "@/app/actions";
import type { AssetType } from "@/lib/constants";
import {
  DEFAULT_GROUP_ORDER,
  flattenSections,
  groupKeyFor,
  groupSections,
  moveGroupTo,
  moveRowWithinGroup,
  type HoldingGroupKey,
} from "@/lib/holdings-groups";
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

type DropTarget =
  | { kind: "row"; id: number; after: boolean }
  | { kind: "group"; key: HoldingGroupKey; after: boolean };

const FILTERS: Array<{ value: HoldingFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "cash", label: "Cash" },
  { value: "stock", label: "Stocks" },
  { value: "stablecoin", label: "Stablecoins" },
  { value: "volatile", label: "Volatile crypto" },
  { value: "other", label: "Other" },
];

function matchesFilter(row: HoldingRow, filter: HoldingFilter) {
  if (filter === "all") return true;
  if (filter === "stablecoin" || filter === "volatile") {
    return row.type === "crypto" && row.cryptoCategory === filter;
  }
  return row.type === filter;
}

function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" className="h-4 w-2.5 fill-current" aria-hidden="true">
      <circle cx="2" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" />
      <circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
      <circle cx="2" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" />
    </svg>
  );
}

export default function HoldingsTable({
  rows,
  initialGroupOrder = DEFAULT_GROUP_ORDER,
}: {
  rows: HoldingRow[];
  initialGroupOrder?: HoldingGroupKey[];
}) {
  const [filter, setFilter] = useState<HoldingFilter>("all");
  const [query, setQuery] = useState("");
  // "manual" follows the saved dashboard order (see Arrange mode).
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "manual", dir: 1 });

  // Arrange mode: move whole categories, and rows inside them, then Save.
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [groupOrder, setGroupOrder] = useState<HoldingGroupKey[]>(initialGroupOrder);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<HoldingGroupKey | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const savedOrder = useRef<number[]>([]);
  const savedGroups = useRef<HoldingGroupKey[]>(initialGroupOrder);

  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row] as const)), [rows]);

  function clearDrag() {
    setDraggingId(null);
    setDraggingGroup(null);
    setDropTarget(null);
  }

  function startArranging() {
    const ids = rows.map((row) => row.id);
    savedOrder.current = ids;
    savedGroups.current = groupOrder;
    setOrder(ids);
    setFilter("all");
    setQuery("");
    setNotice(null);
    setArranging(true);
  }

  function cancelArranging() {
    setOrder(savedOrder.current);
    setGroupOrder(savedGroups.current);
    clearDrag();
    setArranging(false);
  }

  /** Rows in the working order, grouped by the current category order. */
  const arrangedSections = useMemo(() => {
    const orderedRows = order
      .map((id) => rowById.get(id))
      .filter((row): row is HoldingRow => Boolean(row));
    return groupSections(orderedRows, groupOrder);
  }, [groupOrder, order, rowById]);

  /** Categories that currently have holdings, in display order. */
  const visibleGroupKeys = useMemo(() => arrangedSections.map((section) => section.key), [arrangedSections]);

  function moveCategory(key: HoldingGroupKey, delta: number) {
    const index = visibleGroupKeys.indexOf(key);
    const neighbour = visibleGroupKeys[index + delta];
    if (index < 0 || !neighbour) return;
    const next = moveGroupTo(groupOrder, key, neighbour, delta > 0);
    if (next.join() === groupOrder.join()) return;
    setGroupOrder(next);
    setAnnouncement(`${groupLabel(key)} moved to position ${index + delta + 1} of ${visibleGroupKeys.length}.`);
  }

  function moveHolding(id: number, delta: number) {
    const row = rowById.get(id);
    if (!row) return;
    const group = groupKeyFor(row);
    const groupIds = order.filter((candidate) => {
      const candidateRow = rowById.get(candidate);
      return candidateRow ? groupKeyFor(candidateRow) === group : false;
    });
    const index = groupIds.indexOf(id);
    const target = Math.max(0, Math.min(groupIds.length - 1, index + delta));
    if (index < 0 || target === index) return;
    setOrder(moveRowWithinGroup(order, rows, id, groupIds[target], target > index));
    setAnnouncement(`${row.name} moved to position ${target + 1} of ${groupIds.length} in ${groupLabel(group)}.`);
  }

  function handleRowDrop() {
    if (draggingId === null || dropTarget?.kind !== "row") {
      clearDrag();
      return;
    }
    const next = moveRowWithinGroup(order, rows, draggingId, dropTarget.id, dropTarget.after);
    setOrder(next);
    const row = rowById.get(draggingId);
    if (row) {
      const group = groupKeyFor(row);
      const groupIds = next.filter((candidate) => {
        const candidateRow = rowById.get(candidate);
        return candidateRow ? groupKeyFor(candidateRow) === group : false;
      });
      setAnnouncement(`${row.name} moved to position ${groupIds.indexOf(draggingId) + 1} of ${groupIds.length} in ${groupLabel(group)}.`);
    }
    clearDrag();
  }

  function handleGroupDrop() {
    if (!draggingGroup || dropTarget?.kind !== "group") {
      clearDrag();
      return;
    }
    const next = moveGroupTo(groupOrder, draggingGroup, dropTarget.key, dropTarget.after);
    setGroupOrder(next);
    if (next.indexOf(draggingGroup) !== groupOrder.indexOf(draggingGroup)) {
      setAnnouncement(`${groupLabel(draggingGroup)} moved to position ${next.indexOf(draggingGroup) + 1} of ${next.length}.`);
    }
    clearDrag();
  }

  function saveOrder() {
    const sections = groupSections(
      order.map((id) => rowById.get(id)).filter((row): row is HoldingRow => Boolean(row)),
      groupOrder,
    );
    const payload = JSON.stringify(flattenSections(sections).map((row) => row.id));
    const categories = JSON.stringify(groupOrder);
    startSaving(async () => {
      const fd = new FormData();
      fd.set("order", payload);
      fd.set("categories", categories);
      const result: ActionState = await saveAssetOrder({}, fd);
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      savedOrder.current = order;
      savedGroups.current = groupOrder;
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
      const ids = rows.map((row) => row.id);
      setOrder(ids);
      setGroupOrder(DEFAULT_GROUP_ORDER);
      savedOrder.current = ids;
      savedGroups.current = DEFAULT_GROUP_ORDER;
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

  const visibleRows = useMemo(() => {
    if (arranging) return rows;
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => matchesFilter(r, filter))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q));
  }, [arranging, filter, query, rows]);

  const sortedRows = useMemo(() => {
    if (sort.key === "manual") return visibleRows;
    const k: Exclude<SortKey, "manual"> = sort.key;
    return [...visibleRows].sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
      return ((av as number) - (bv as number)) * sort.dir;
    });
  }, [sort, visibleRows]);

  const grouped = sort.key === "manual";
  const sections = useMemo(
    () => (grouped ? groupSections(visibleRows, groupOrder) : []),
    [grouped, groupOrder, visibleRows],
  );
  const showGroupHeaders = grouped && !arranging && filter === "all" && sections.length > 1;
  const columnCount = arranging ? 8 : 7;

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

  function renderRow(r: HoldingRow) {
    const isCash = r.type === "cash";
    const dragging = draggingId === r.id;
    const rowDrop = dropTarget?.kind === "row" && dropTarget.id === r.id ? dropTarget : null;
    return (
      <tr
        key={r.id}
        draggable={arranging}
        onDragStart={(event) => {
          if (!arranging) return;
          setDraggingId(r.id);
          setDraggingGroup(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(r.id));
        }}
        onDragEnd={clearDrag}
        onDragOver={(event) => {
          if (!arranging || draggingId === null || draggingId === r.id) return;
          const dragged = rowById.get(draggingId);
          if (!dragged || groupKeyFor(dragged) !== groupKeyFor(r)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          const after = event.clientY - rect.top > rect.height / 2;
          setDropTarget((current) =>
            current?.kind === "row" && current.id === r.id && current.after === after
              ? current
              : { kind: "row", id: r.id, after },
          );
        }}
        onDrop={(event) => {
          if (!arranging) return;
          event.preventDefault();
          handleRowDrop();
        }}
        className={`group transition ${
          dragging
            ? "opacity-40"
            : rowDrop
              ? `bg-indigo-50/60 ${rowDrop.after ? "shadow-[inset_0_-2px_0_0_#6366f1]" : "shadow-[inset_0_2px_0_0_#6366f1]"}`
              : "hover:bg-slate-50/80"
        } ${arranging ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {arranging && (
          <td className="px-3 py-3 align-middle">
            <div className="flex items-center gap-1">
              <span className="grid h-8 w-5 place-items-center text-slate-400" title="Drag to reorder">
                <GripIcon />
              </span>
              <span className="flex flex-col">
                <button
                  type="button"
                  className="grid h-4 w-6 place-items-center rounded text-[10px] text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30"
                  onClick={() => moveHolding(r.id, -1)}
                  aria-label={`Move ${r.name} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="grid h-4 w-6 place-items-center rounded text-[10px] text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30"
                  onClick={() => moveHolding(r.id, 1)}
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
              <span className="block truncate font-medium text-slate-900 group-hover:text-indigo-600">{r.name}</span>
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
  }

  /** Section heading row: static in normal mode, draggable in arrange mode. */
  function renderGroupHeader(section: (typeof sections)[number]) {
    const subtotal = section.rows.reduce((sum, row) => sum + row.value, 0);
    const groupDrop = dropTarget?.kind === "group" && dropTarget.key === section.key ? dropTarget : null;
    const dragging = draggingGroup === section.key;

    if (!arranging) {
      return (
        <tr key={`group-${section.key}`} className="bg-slate-50/70">
          <td colSpan={columnCount} className="px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: section.meta.color }} />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{section.meta.label}</span>
              <span className="rounded-full bg-slate-200/70 px-1.5 text-[11px] font-medium text-slate-600">
                {section.rows.length}
              </span>
              <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">{money(subtotal)}</span>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr
        key={`group-${section.key}`}
        draggable
        onDragStart={(event) => {
          setDraggingGroup(section.key);
          setDraggingId(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", `group:${section.key}`);
        }}
        onDragEnd={clearDrag}
        onDragOver={(event) => {
          if (!draggingGroup || draggingGroup === section.key) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          const after = event.clientY - rect.top > rect.height / 2;
          setDropTarget((current) =>
            current?.kind === "group" && current.key === section.key && current.after === after
              ? current
              : { kind: "group", key: section.key, after },
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleGroupDrop();
        }}
        className={`cursor-grab bg-slate-100 active:cursor-grabbing ${dragging ? "opacity-40" : ""} ${
          groupDrop ? (groupDrop.after ? "shadow-[inset_0_-2px_0_0_#4f46e5]" : "shadow-[inset_0_2px_0_0_#4f46e5]") : ""
        }`}
      >
        <td colSpan={columnCount} className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-5 place-items-center text-slate-400" title="Drag to move this category">
              <GripIcon />
            </span>
            <span className="flex flex-col">
              <button
                type="button"
                className="grid h-4 w-6 place-items-center rounded text-[10px] text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30"
                onClick={() => moveCategory(section.key, -1)}
                disabled={visibleGroupKeys.indexOf(section.key) <= 0}
                aria-label={`Move ${section.meta.label} category up`}
              >
                ▲
              </button>
              <button
                type="button"
                className="grid h-4 w-6 place-items-center rounded text-[10px] text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-30"
                onClick={() => moveCategory(section.key, 1)}
                disabled={visibleGroupKeys.indexOf(section.key) === visibleGroupKeys.length - 1}
                aria-label={`Move ${section.meta.label} category down`}
              >
                ▼
              </button>
            </span>
            <span className="h-2 w-2 rounded-full" style={{ background: section.meta.color }} />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">{section.meta.label}</span>
            <span className="rounded-full bg-white px-2 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
              {section.rows.length}
            </span>
            <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">{money(subtotal)}</span>
          </div>
        </td>
      </tr>
    );
  }

  const arrangedRowCount = arrangedSections.reduce((sum, section) => sum + section.rows.length, 0);

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
              Drag a <strong>category header</strong> to move that whole section up or down. Drag a row to reorder
              inside its category. Arrow buttons work on touch screens. Nothing changes until you save.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={cancelArranging} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-ghost" onClick={resetOrder} disabled={saving}>
              Reset to default
            </button>
            <button type="button" className="btn-primary" onClick={saveOrder} disabled={saving || arrangedRowCount === 0}>
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
            title={rows.length < 2 ? "Add at least two holdings to reorder them" : "Reorder categories and holdings"}
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
            {arranging
              ? arrangedSections.map((section) => (
                  <Fragment key={section.key}>
                    {renderGroupHeader(section)}
                    {section.rows.map(renderRow)}
                  </Fragment>
                ))
              : grouped
                ? sections.map((section) => (
                    <Fragment key={section.key}>
                      {showGroupHeaders && renderGroupHeader(section)}
                      {section.rows.map(renderRow)}
                    </Fragment>
                  ))
                : sortedRows.map(renderRow)}

            {(arranging ? arrangedRowCount : grouped ? sections.reduce((sum, section) => sum + section.rows.length, 0) : sortedRows.length) === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-slate-400">
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

function groupLabel(key: HoldingGroupKey) {
  return {
    cash: "Cash",
    stock: "Stocks",
    "crypto-stablecoin": "Stablecoins",
    "crypto-volatile": "Volatile crypto",
    other: "Other",
  }[key];
}
