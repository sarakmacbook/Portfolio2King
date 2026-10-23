"use client";

import Link from "next/link";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import type { AssetType } from "@/lib/constants";
import { TYPE_META, money, pct, pnlColor, qty } from "@/lib/format";
import {
  DEFAULT_HOLDING_FILTER_ORDER,
  categoryFilterLabel,
  getSelectedHoldingFilter,
  matchesHoldingFilter,
  moveHoldingFilterBy,
  moveHoldingFilterTo,
  orderHoldingFilters,
  setSelectedHoldingFilter,
  subscribeHoldingFilter,
  type HoldingFilter,
} from "@/lib/holdings-filter";
import {
  applyHoldingOrder,
  moveHoldingBy,
  moveHoldingTo,
  normaliseHoldingOrder,
} from "@/lib/holdings-order";
import {
  countInFolder,
  groupByFolder,
  matchesFolderFilter,
  type FolderAssignments,
  type FolderFilter,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { PROVIDER_LABELS, type PriceProvider } from "@/lib/market-prices";
import CryptoLogo from "./CryptoLogo";
import ExchangeIcon, { EXCHANGE_BRAND_COLORS } from "./ExchangeIcon";
import GripIcon from "./GripIcon";
import HoldingsFolders from "./HoldingsFolders";
import { useHoldingsArrange } from "./holdings-arrange";

export type HoldingRow = {
  id: number;
  type: AssetType;
  name: string;
  symbol: string;
  cryptoCategory: "stablecoin" | "volatile";
  wallet?: string;
  /** Exchange a crypto holding is priced from, shown as a small badge. */
  priceSource?: PriceProvider | "";
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

type SortKey = "custom" | "name" | "value" | "pnl" | "pnlPct" | "weight";

/** Every sort key but the (arranged) custom one. */
type ColumnSortKey = Exclude<SortKey, "custom">;

/** Column sorting, shared by the visible rows and the arrangement seed. */
function compareHoldingRows(
  a: HoldingRow,
  b: HoldingRow,
  key: ColumnSortKey,
  dir: 1 | -1,
): number {
  const av = a[key];
  const bv = b[key];
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
  return ((av as number) - (bv as number)) * dir;
}

/** Mobile has no table header, so sorting is offered as a select instead. */
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  /** The order the rows were dragged into (default when one is saved). */
  { value: "custom:1", label: "Custom · my arrangement" },
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
  /**
   * Inside the dashboard the "Arrange layout" mode owns the category order, the
   * order of the holdings themselves, and saves both with everything else; on
   * its own the table keeps the default order and the tabs are just clickable.
   */
  const arrange = useHoldingsArrange();
  const [localCategoryOrder, setLocalCategoryOrder] =
    useState<HoldingFilter[]>(DEFAULT_HOLDING_FILTER_ORDER);
  const [localAssetOrder, setLocalAssetOrder] = useState<number[]>([]);
  const [localFolders, setLocalFolders] = useState<HoldingFolder[]>([]);
  const [localAssignments, setLocalAssignments] = useState<FolderAssignments>({});
  const arranging = arrange?.arranging ?? false;
  const categoryOrder = arrange?.categoryOrder ?? localCategoryOrder;
  const setCategoryOrder = arrange?.onCategoryOrderChange ?? setLocalCategoryOrder;
  const assetOrder = arrange?.assetOrder ?? localAssetOrder;
  const setAssetOrder = arrange?.onAssetOrderChange ?? setLocalAssetOrder;
  const folders = arrange?.folders ?? localFolders;
  const setFolders = arrange?.onFoldersChange ?? setLocalFolders;
  const assignments = arrange?.assignments ?? localAssignments;
  const setAssignments = arrange?.onAssignmentsChange ?? setLocalAssignments;

  const [query, setQuery] = useState("");
  // A saved arrangement is what the table shows until a column is sorted on.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() =>
    assetOrder.length > 0 ? { key: "custom", dir: 1 } : { key: "value", dir: -1 },
  );
  const [dragging, setDragging] = useState<HoldingFilter | null>(null);
  const [drop, setDrop] = useState<{ key: HoldingFilter; after: boolean } | null>(null);
  const [rowDragging, setRowDragging] = useState<number | null>(null);
  const [rowDrop, setRowDrop] = useState<{ id: number; after: boolean } | null>(null);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  /** Collapsed groups — a view preference, not part of the saved layout. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(folders.filter((folder) => folder.collapsed).map((folder) => folder.id)),
  );
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    return () => {
      setSelectedHoldingFilter("all");
    };
  }, []);

  // Leaving arrange mode mid-drag must not leave a highlighted drop target.
  useEffect(() => {
    if (arranging) return;
    setDragging(null);
    setDrop(null);
    setRowDragging(null);
    setRowDrop(null);
  }, [arranging]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, stablecoin: 0, volatile: 0 };
    for (const r of rows) {
      c[r.type] = (c[r.type] ?? 0) + 1;
      if (r.type === "crypto") c[r.cryptoCategory] = (c[r.cryptoCategory] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  /** The category tabs in the arranged order (the default when never moved). */
  const categories = useMemo(() => orderHoldingFilters(categoryOrder), [categoryOrder]);

  function clearDrag() {
    setDragging(null);
    setDrop(null);
  }

  function moveCategory(key: HoldingFilter, delta: number) {
    const from = categoryOrder.indexOf(key);
    const to = Math.max(0, Math.min(categoryOrder.length - 1, from + delta));
    if (from < 0 || to === from) return;
    setCategoryOrder(moveHoldingFilterBy(categoryOrder, key, delta));
    setAnnouncement(
      `${categoryFilterLabel(key)} tab moved to position ${to + 1} of ${categoryOrder.length}.`,
    );
  }

  function handleCategoryDrop() {
    if (!dragging || !drop || dragging === drop.key) {
      clearDrag();
      return;
    }
    const next = moveHoldingFilterTo(categoryOrder, dragging, drop.key, drop.after);
    setCategoryOrder(next);
    setAnnouncement(
      `${categoryFilterLabel(dragging)} tab moved to position ${next.indexOf(dragging) + 1} of ${next.length}.`,
    );
    clearDrag();
  }

  function clearRowDrag() {
    setRowDragging(null);
    setRowDrop(null);
  }

  /** A row's name for the screen-reader announcements. */
  function rowLabel(id: number): string {
    const row = rows.find((r) => r.id === id);
    return row ? row.symbol || row.name : "Holding";
  }

  /** Position of a row in the whole arrangement (1-based). */
  function rowPosition(id: number): number {
    return fullOrder.indexOf(id) + 1;
  }

  function moveHolding(id: number, delta: number) {
    const from = fullOrder.indexOf(id);
    const to = Math.max(0, Math.min(fullOrder.length - 1, from + delta));
    if (from < 0 || to === from) return;
    setAssetOrder(moveHoldingBy(fullOrder, id, delta));
    setSort({ key: "custom", dir: 1 });
    setAnnouncement(`${rowLabel(id)} moved to position ${to + 1} of ${fullOrder.length}.`);
  }

  function handleHoldingDrop() {
    if (rowDragging === null || !rowDrop || rowDragging === rowDrop.id) {
      clearRowDrag();
      return;
    }
    const next = moveHoldingTo(fullOrder, rowDragging, rowDrop.id, rowDrop.after);
    setAssetOrder(next);
    setSort({ key: "custom", dir: 1 });
    setAnnouncement(
      `${rowLabel(rowDragging)} moved to position ${next.indexOf(rowDragging) + 1} of ${next.length}.`,
    );
    clearRowDrag();
  }

  /**
   * Drag-and-drop wiring for one holding, shared by the desktop row and the
   * phone card. Only the grip starts a drag; dropping above or below the middle
   * of a row puts the dragged holding before or after it.
   */
  function holdingDragProps(id: number) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!arranging || rowDragging === null || rowDragging === id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY - rect.top > rect.height / 2;
        setRowDrop((current) =>
          current?.id === id && current.after === after ? current : { id, after },
        );
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!arranging) return;
        event.preventDefault();
        handleHoldingDrop();
      },
    };
  }

  /** The dashed grip + ▲ / ▼ strip shown on a holding while arranging. */
  function holdingArrangeControls(id: number, name: string, className = "") {
    const position = rowPosition(id);
    return (
      <span className={`flex items-center gap-1 ${className}`}>
        <span
          draggable
          onDragStart={(event) => {
            setRowDragging(id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(id));
          }}
          onDragEnd={clearRowDrag}
          className="flex cursor-grab items-center gap-1 text-indigo-700 active:cursor-grabbing"
          title="Drag to move this holding"
        >
          <GripIcon className="h-3.5 w-2.5" />
          <span className="text-[10px] font-medium tabular-nums">{position}</span>
        </span>
        <span className="flex flex-col">
          <button
            type="button"
            className="grid h-4 w-5 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
            onClick={() => moveHolding(id, -1)}
            disabled={position <= 1}
            aria-label={`Move ${name} up`}
          >
            ▲
          </button>
          <button
            type="button"
            className="grid h-4 w-5 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
            onClick={() => moveHolding(id, 1)}
            disabled={position >= fullOrder.length}
            aria-label={`Move ${name} down`}
          >
            ▼
          </button>
        </span>
      </span>
    );
  }

  /** Every holding's id, in the order it arrived in (the base for arranging). */
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  /**
   * The complete arrangement the ▲ / ▼ buttons and drag-and-drop move things
   * around in: the saved ids that still exist first, then any holding the saved
   * order does not know about (a newly added asset) at the end. With nothing
   * saved yet, the arrangement simply *is* what is on screen — so the first
   * nudge or drop starts from the order the user is looking at, and a trip
   * through arrange mode alone never freezes the table.
   */
  const fullOrder = useMemo(() => {
    if (assetOrder.length > 0) return normaliseHoldingOrder(assetOrder, rowIds);
    if (sort.key === "custom") return rowIds;
    const key = sort.key;
    return [...rows].sort((a, b) => compareHoldingRows(a, b, key, sort.dir)).map((r) => r.id);
  }, [assetOrder, sort, rows, rowIds]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = rows
      .filter((r) => matchesHoldingFilter(r, filter))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q));
    // The custom order is an actual sort key, so filtering or searching a
    // category never loses the arrangement: hidden rows keep their place.
    if (sort.key === "custom") return applyHoldingOrder(visible, fullOrder);
    const key = sort.key;
    return visible.sort((a, b) => compareHoldingRows(a, b, key, sort.dir));
  }, [rows, filter, query, sort, fullOrder]);

  /**
   * Entering arrange mode shows the saved arrangement rather than whatever column
   * was last sorted on; without one, the rows keep the order they are in and the
   * first move turns that into a custom arrangement.
   */
  const wasArranging = useRef(false);
  useEffect(() => {
    if (arranging && !wasArranging.current && assetOrder.length > 0) {
      setSort({ key: "custom", dir: 1 });
    }
    wasArranging.current = arranging;
  }, [arranging, assetOrder.length]);

  // "Custom" with nothing arranged (e.g. after Reset to default) falls back to
  // the value column rather than an arbitrary order.
  useEffect(() => {
    if (arranging || assetOrder.length > 0) return;
    setSort((current) => (current.key === "custom" ? { key: "value", dir: -1 } : current));
  }, [arranging, assetOrder.length]);

  const hasFolders = folders.length > 0;
  /** Order + Asset + Folder + Quantity + Avg cost + Price + Value + P/L + Weight. */
  const columnCount = 7 + (arranging ? 1 : 0) + (hasFolders ? 1 : 0);
  const folderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);

  /** Counts and value per folder, for the chips and the group headers. */
  const folderStats = useMemo(() => {
    const counts: Record<string, number> = {};
    const totals: Record<string, number> = {};
    for (const folder of folders) {
      counts[folder.id] = countInFolder(assignments, folder.id);
      totals[folder.id] = 0;
    }
    let unfiledCount = 0;
    for (const row of rows) {
      const folderId = assignments[row.id];
      if (!folderId || !(folderId in counts)) {
        unfiledCount += 1;
        continue;
      }
      totals[folderId] += row.value;
    }
    return { counts, totals, unfiledCount };
  }, [folders, assignments, rows]);

  /** The rows the folder filter keeps (category tabs and search apply too). */
  const folderRows = useMemo(
    () => shown.filter((row) => matchesFolderFilter(folderFilter, row.id, assignments, folderIds)),
    [shown, folderFilter, assignments, folderIds],
  );

  /**
   * Rows split into folder groups. Without folders (or while searching, where a
   * group header would only repeat the query) the table stays one flat list and
   * looks exactly as it did before folders existed.
   */
  const groups = useMemo(() => {
    if (!hasFolders) return [{ folder: null, rows: folderRows, totalValue: 0 }];
    return groupByFolder(folderRows, folders, assignments);
  }, [hasFolders, folderRows, folders, assignments]);

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setFolderFor(row: HoldingRow, folderId: string) {
    const next = { ...assignments };
    if (!folderId) delete next[row.id];
    else next[row.id] = folderId;
    setAssignments(next);
    const name = folders.find((folder) => folder.id === folderId)?.name;
    setAnnouncement(`${row.symbol || row.name} moved to ${name ?? "Unfiled"}.`);
  }

  /** The small folder badge/selector shown with each holding. */
  function folderControl(row: HoldingRow) {
    const folder = folders.find((item) => item.id === assignments[row.id]);
    if (arranging) {
      return (
        <select
          className="input w-full min-w-0 py-1 text-xs"
          value={folder?.id ?? ""}
          onChange={(event) => setFolderFor(row, event.target.value)}
          aria-label={`Folder for ${row.name}`}
        >
          <option value="">Unfiled</option>
          {folders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      );
    }
    if (!folder) return <span className="text-xs text-slate-400">—</span>;
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-lg bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
        <ExchangeIcon
          provider={folder.icon === "exchange" ? (folder.glyph as PriceProvider) : undefined}
          glyph={folder.icon === "emoji" ? folder.glyph : undefined}
          label={folder.name.slice(0, 1)}
          color={folder.color}
          className="h-3.5 w-3.5 rounded"
        />
        <span className="truncate">{folder.name}</span>
      </span>
    );
  }

  /** Group heading shared by the table and the phone list. */
  function groupHeader(group: { folder: HoldingFolder | null; rows: HoldingRow[]; totalValue: number }) {
    const key = group.folder?.id ?? "unfiled";
    const isCollapsed = collapsedGroups.has(key);
    return (
      <button
        type="button"
        onClick={() => toggleGroup(key)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={!isCollapsed}
      >
        <span className="w-3 text-[10px] text-slate-400">{isCollapsed ? "▶" : "▼"}</span>
        {group.folder ? (
          <ExchangeIcon
            provider={group.folder.icon === "exchange" ? (group.folder.glyph as PriceProvider) : undefined}
            glyph={group.folder.icon === "emoji" ? group.folder.glyph : undefined}
            label={group.folder.name.slice(0, 1)}
            color={group.folder.color}
            className="h-4 w-4 rounded"
          />
        ) : (
          <span className="grid h-4 w-4 place-items-center rounded bg-slate-100 text-[9px] font-bold text-slate-500">
            ?
          </span>
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {group.folder?.name ?? "Unfiled"}
        </span>
        <span className="text-[11px] font-normal normal-case text-slate-400">
          {group.rows.length} holding{group.rows.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">
          {money(group.totalValue)}
        </span>
      </button>
    );
  }

  const th = (key: SortKey, label: string, align = "text-right") => (
    <th className={`px-4 py-3 font-medium ${align}`}>
      {/* While arranging, the column headers would only re-order the rows
          behind the arrangement the user is editing, so they stay labels. */}
      {arranging ? (
        <span>{label}</span>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-slate-900"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}
        >
          {label}
          <span className="text-[10px]">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
        </button>
      )}
    </th>
  );

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        {arranging ? (
          /* Arrange mode: every category becomes a draggable pill with ◀ / ▶
             buttons, wrapping instead of scrolling so each one stays reachable. */
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.map(({ value, label }, position) => {
              const isDragging = dragging === value;
              const isDropTarget = drop?.key === value && !isDragging;
              return (
                <div
                  key={value}
                  onDragOver={(event) => {
                    if (!dragging || dragging === value) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const after = event.clientX - rect.left > rect.width / 2;
                    setDrop((current) =>
                      current?.key === value && current.after === after ? current : { key: value, after },
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleCategoryDrop();
                  }}
                  className={`flex items-center gap-1 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1 ${
                    isDragging ? "opacity-50" : ""
                  } ${
                    isDropTarget ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-50" : ""
                  }`}
                >
                  <span
                    draggable
                    onDragStart={(event) => {
                      setDragging(value);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", value);
                    }}
                    onDragEnd={clearDrag}
                    className="flex cursor-grab items-center gap-1.5 whitespace-nowrap text-xs font-medium text-indigo-900 active:cursor-grabbing"
                    title="Drag to move this category"
                  >
                    <GripIcon className="h-3 w-2" />
                    {label}
                    <span className="text-[10px] tabular-nums text-indigo-700/70">{counts[value] ?? 0}</span>
                  </span>
                  <span className="flex">
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => moveCategory(value, -1)}
                      disabled={position === 0}
                      aria-label={`Move ${label} left`}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => moveCategory(value, 1)}
                      disabled={position === categories.length - 1}
                      aria-label={`Move ${label} right`}
                    >
                      ▶
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tab-strip -mx-1 flex gap-1 overflow-x-auto px-1">
            {categories.map(({ value, label }) => (
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
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input min-w-0 sm:max-w-56"
            placeholder="Search name or symbol…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search holdings"
          />
          {!arranging && (
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
          )}
        </div>
      </div>

      {(hasFolders || arranging) && (
        <HoldingsFolders
          folders={folders}
          assignments={assignments}
          counts={folderStats.counts}
          totals={folderStats.totals}
          unfiledCount={folderStats.unfiledCount}
          totalRows={rows.length}
          selected={folderFilter}
          onSelect={setFolderFilter}
          arranging={arranging}
          onFoldersChange={setFolders}
          onAssignmentsChange={setAssignments}
        />
      )}

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {arranging && (
                <th className="w-14 px-2 py-3 text-left font-medium" scope="col">
                  Order
                </th>
              )}
              {th("name", "Asset", "text-left")}
              {hasFolders && <th className="px-4 py-3 text-left font-medium">Folder</th>}
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Avg cost</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              {th("value", "Value")}
              {th("pnl", "P/L")}
              {th("weight", "Weight")}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((group) => {
              const groupKey = group.folder?.id ?? "unfiled";
              const isCollapsed = collapsedGroups.has(groupKey);
              return (
                <Fragment key={groupKey}>
                  {hasFolders && (
                    <tr className="bg-slate-50/60">
                      <th colSpan={columnCount} className="px-4 py-2 font-normal" scope="colgroup">
                        {groupHeader(group)}
                      </th>
                    </tr>
                  )}
                  {!isCollapsed && group.rows.map((r) => {
              const isCash = r.type === "cash";
              const isDragging = rowDragging === r.id;
              const isDropTarget = rowDrop?.id === r.id && !isDragging;
              return (
                <tr
                  key={r.id}
                  {...holdingDragProps(r.id)}
                  className={`group transition hover:bg-slate-50/80 ${isDragging ? "opacity-50" : ""} ${
                    isDropTarget ? "bg-indigo-50/70 ring-2 ring-inset ring-indigo-400" : ""
                  }`}
                >
                  {arranging && (
                    <td className="px-2 py-3 align-middle">
                      <span className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-1.5 py-1">
                        {holdingArrangeControls(r.id, r.name)}
                      </span>
                    </td>
                  )}
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
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-slate-900 group-hover:text-indigo-600">
                            {r.name}
                          </span>
                          {r.priceSource && (
                            <ExchangeIcon
                              provider={r.priceSource}
                              color={EXCHANGE_BRAND_COLORS[r.priceSource]}
                              className="h-3.5 w-3.5 rounded"
                              title={`Priced from ${PROVIDER_LABELS[r.priceSource]}`}
                            />
                          )}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {r.symbol && r.symbol !== r.name ? `${r.symbol} · ` : ""}
                          {r.type === "crypto" ? (r.cryptoCategory === "stablecoin" ? "Crypto · Stablecoin" : "Crypto · Volatile") : TYPE_META[r.type].label}
                          {r.priceSource ? ` · ${PROVIDER_LABELS[r.priceSource]}` : ""}
                        </span>
                      </span>
                    </Link>
                  </td>
                  {hasFolders && (
                    <td className="px-4 py-3 align-middle">{folderControl(r)}</td>
                  )}
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
                </Fragment>
              );
            })}
            {folderRows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-slate-400">
                  No holdings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per holding instead of a 760px-wide table. */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {groups.map((group) => {
          const groupKey = group.folder?.id ?? "unfiled";
          const isCollapsed = collapsedGroups.has(groupKey);
          return (
            <Fragment key={groupKey}>
              {hasFolders && (
                <li className="bg-slate-50/60 px-4 py-2">{groupHeader(group)}</li>
              )}
              {!isCollapsed && group.rows.map((r) => {
          const isCash = r.type === "cash";
          const subtitle = r.type === "crypto"
            ? r.cryptoCategory === "stablecoin"
              ? "Crypto · Stablecoin"
              : "Crypto · Volatile"
            : TYPE_META[r.type].label;
          const isDragging = rowDragging === r.id;
          const isDropTarget = rowDrop?.id === r.id && !isDragging;
          return (
            <li
              key={r.id}
              {...holdingDragProps(r.id)}
              className={`px-4 py-3 ${isDragging ? "opacity-50" : ""} ${
                isDropTarget ? "bg-indigo-50/70 ring-2 ring-inset ring-indigo-400" : ""
              }`}
            >
              {arranging && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-indigo-900">
                    Holding
                  </span>
                  {holdingArrangeControls(r.id, r.name, "ml-auto")}
                </div>
              )}
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
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-900">{r.name}</span>
                    {r.priceSource && (
                      <ExchangeIcon
                        provider={r.priceSource}
                        color={EXCHANGE_BRAND_COLORS[r.priceSource]}
                        className="h-3.5 w-3.5 rounded"
                        title={`Priced from ${PROVIDER_LABELS[r.priceSource]}`}
                      />
                    )}
                  </span>
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
              {hasFolders && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-12 shrink-0 text-slate-400">Folder</span>
                  {folderControl(r)}
                </div>
              )}
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
            </Fragment>
          );
        })}
        {folderRows.length === 0 && (
          <li className="px-4 py-12 text-center text-sm text-slate-400">No holdings match.</li>
        )}
      </ul>
    </div>
  );
}
