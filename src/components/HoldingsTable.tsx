"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
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
  assignHolding,
  countInFolder,
  matchesFolderFilter,
  splitByFolder,
  type FolderGroup,
  type FolderAssignments,
  type FolderFilter,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { DEFAULT_DUST_THRESHOLD_USD, normaliseDustThreshold, splitDust } from "@/lib/wallet-dust";
import { spamReasonOf, splitSpam } from "@/lib/wallet-spam";
import { PROVIDER_LABELS, type PriceProvider } from "@/lib/market-prices";
import { removeSpamHoldings, saveHoldingFolderAssignment } from "@/app/actions";
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
  /**
   * Looks like airdropped junk. Spam rows are worth nothing in the totals (their
   * price is invented), so the cells show a dash instead of a number.
   */
  spam?: boolean;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  weight: number;
};

type SortKey = "custom" | "name" | "value" | "pnl" | "pnlPct" | "weight";

/** Marks a row that the spam filter would hide, once the user asks to see them. */
function SpamBadge({ row }: { row: { name: string; symbol: string } }) {
  const reason = spamReasonOf(row);
  if (!reason) return null;
  return (
    <span
      className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
      title={`Looks like spam: ${reason}`}
    >
      spam?
    </span>
  );
}

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
  const clearAllGroupsState = arrange?.onClearGroups ?? (() => {
    setLocalFolders([]);
    setLocalAssignments({});
  });

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
  /**
   * Hide holdings worth less than a dollar (dust). Off by default: a portfolio
   * should never look like it is missing something the user added.
   */
  const [hideDust, setHideDust] = useState(false);
  const [dustThreshold, setDustThreshold] = useState(String(DEFAULT_DUST_THRESHOLD_USD));
  /**
   * Hide holdings that look like airdropped spam. On by default — a spam token
   * with a made-up price sits near the top of the table and is the one thing a
   * dust cut-off cannot catch — but always reported with a one-click undo.
   */
  const [showSpam, setShowSpam] = useState(false);
  /** Folder id of the group a holding is hovering over. */
  const [groupDrop, setGroupDrop] = useState<string | null>(null);
  const [filingError, setFilingError] = useState("");
  const [filing, startFiling] = useTransition();
  /** Result of the last "Remove them" click, so the clean-up is never silent. */
  const [spamCleanup, setSpamCleanup] = useState("");
  const [removingSpam, startRemovingSpam] = useTransition();
  const router = useRouter();
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
        if (rowDragging === null || rowDragging === id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY - rect.top > rect.height / 2;
        setRowDrop((current) =>
          current?.id === id && current.after === after ? current : { id, after },
        );
        setGroupDrop(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (rowDragging === null) return;
        event.preventDefault();
        if (arranging) {
          handleHoldingDrop();
          return;
        }
        // In normal view a drop on a row files the holding into that row's
        // folder, which is the quickest way to "put this next to that one".
        fileHolding(rowDragging, assignments[id] ?? null);
        setRowDrop(null);
      },
    };
  }

  /**
   * A whole folder group is a drop target too: dropping a holding anywhere in
   * its header or its rows files it into that folder. This is what makes
   * dragging a holding *under* a folder work without aiming at the chips.
   */
  function groupDropProps(folderId: string) {
    const key = folderId;
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (rowDragging === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setRowDrop(null);
        setGroupDrop(key);
      },
      onDragLeave: () => setGroupDrop((current) => (current === key ? null : current)),
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (rowDragging === null) return;
        event.preventDefault();
        fileHolding(rowDragging, folderId);
      },
    };
  }

  /**
   * The grip shown on a holding in normal view (only once folders exist). It is
   * hover-revealed and decorative: the dropdown above is the keyboard/touch path,
   * so a screen reader is not given a drag handle it cannot use.
   */
  function viewDragHandle(row: HoldingRow, className = "") {
    return (
      <span
        draggable
        onDragStart={(event) => {
          setRowDragging(row.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(row.id));
        }}
        onDragEnd={clearRowDrag}
        className={`cursor-grab text-slate-300 opacity-100 transition hover:text-slate-400 active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 ${className}`}
        title={`Drag ${row.name} into a folder`}
        aria-hidden="true"
      >
        <GripIcon className="h-3.5 w-2.5" />
      </span>
    );
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

  const rootFolders = useMemo(() => folders.filter((folder) => !folder.parentAssetId), [folders]);
  const nestedFolders = useMemo(() => folders.filter((folder) => folder.parentAssetId), [folders]);
  const hasFolders = folders.length > 0;
  /** Order + Asset + Folder + Quantity + Avg cost + Price + Value + P/L + Weight. */
  const columnCount = 7 + (arranging ? 1 : 0) + (hasFolders ? 1 : 0);
  const folderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);

  function folderLabel(folder: HoldingFolder) {
    const parent = folder.parentAssetId ? rows.find((row) => row.id === folder.parentAssetId) : undefined;
    return parent ? `${parent.name} / ${folder.name}` : folder.name;
  }

  /** Counts and value per top-level folder, for the chips and group headers. */
  const folderStats = useMemo(() => {
    const counts: Record<string, number> = {};
    const totals: Record<string, number> = {};
    for (const folder of rootFolders) {
      counts[folder.id] = countInFolder(assignments, folder.id);
      totals[folder.id] = 0;
    }
    for (const row of rows) {
      const folderId = assignments[row.id];
      if (!folderId || !(folderId in counts)) continue;
      totals[folderId] += row.value;
    }
    return { counts, totals };
  }, [rootFolders, assignments, rows]);

  /**
   * Dust: holdings worth less than the cut-off. Hidden only when asked for, and
   * always reported (`dustSplit.dustCount`) so the table never silently loses a
   * row. Arrange mode ignores the filter — hiding rows there would make them
   * impossible to move.
   */
  const dustCut = hideDust && !arranging ? normaliseDustThreshold(dustThreshold) : 0;
  /** Spam first, then dust on what is left — a fake price passes a dollar cut-off. */
  const spamSplit = useMemo(() => splitSpam(shown, !showSpam && !arranging), [shown, showSpam, arranging]);
  const dustSplit = useMemo(() => splitDust(spamSplit.kept, dustCut), [spamSplit, dustCut]);

  /** The rows the folder filter keeps (category tabs and search apply too). */
  const folderRows = useMemo(
    () =>
      dustSplit.kept.filter((row) =>
        matchesFolderFilter(folderFilter, row.id, assignments, folderIds),
      ),
    [dustSplit, folderFilter, assignments, folderIds],
  );

  /**
   * Rows split into folders plus the holdings that are in no folder.
   *
   * There is no "Unfiled" bucket: a holding without a folder is simply a normal
   * row, listed above the folders exactly as it was before folders existed. With
   * no folders at all, every row is one flat list.
   */
  const { ungrouped, groups } = useMemo(() => {
    if (rootFolders.length === 0) return { ungrouped: folderRows, groups: [] as FolderGroup<HoldingRow>[] };
    return splitByFolder(folderRows, rootFolders, assignments);
  }, [rootFolders, folderRows, assignments]);

  /**
   * Show every top-level group as a table section, even while it is empty, so a
   * newly created folder is visible alongside assets before anything is filed.
   * With a category or search filter, retain only groups that have matching rows.
   */
  const displayGroups = useMemo(() => {
    const showEmptyGroups = query.trim() === "" && filter === "all";
    const visibleFolders = rootFolders.filter(
      (folder) => folderFilter === "all" || folderFilter === `folder:${folder.id}`,
    );
    return visibleFolders.flatMap((folder) => {
      const group = groups.find((item) => item.folder.id === folder.id);
      if (group) return [group];
      return showEmptyGroups ? [{ folder, rows: [], totalValue: 0 }] : [];
    });
  }, [rootFolders, groups, folderFilter, query, filter]);

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Files a holding into a folder (`null` = no folder) — the one path used by the
   * drag-and-drop, the group drop zones and the per-row dropdown.
   *
   * Inside arrange mode the change is pending: it lives in the dialog's state and
   * **Save layout** writes it with everything else. In normal view a drop should
   * simply work, so the local state updates straight away (optimistic) and the
   * single assignment is stored immediately; if the server refuses, the previous
   * filing is put back.
   */
  function fileHolding(assetId: number, folderId: string | null) {
    const target = folderId && folders.some((folder) => folder.id === folderId) ? folderId : null;
    const previous = assignments;
    if ((previous[assetId] ?? null) === target) return;

    const targetFolder = folders.find((folder) => folder.id === target);
    setAssignments(assignHolding(previous, assetId, target));
    setFilingError("");
    setAnnouncement(
      targetFolder
        ? `${rowLabel(assetId)} moved to ${folderLabel(targetFolder)}.`
        : `${rowLabel(assetId)} moved out of its folder.`,
    );
    clearRowDrag();
    setGroupDrop(null);

    if (arranging) return;

    startFiling(async () => {
      const result = await saveHoldingFolderAssignment({ assetId, folderId: target });
      if (!result.ok) {
        setAssignments(previous);
        setFilingError(result.error ?? "Could not move that holding.");
        setAnnouncement(`${rowLabel(assetId)} is back in its folder — the move did not save.`);
        return;
      }
      router.refresh();
    });
  }

  /** The small folder badge/selector shown with each holding. */
  function folderControl(row: HoldingRow) {
    const folder = folders.find((item) => item.id === assignments[row.id]);
    // The dropdown is the keyboard- and touch-friendly way to move a holding:
    // native drag-and-drop needs a mouse, so on a phone this is the only path.
    if (arranging || hasFolders) {
      return (
        <select
          className="input w-full min-w-0 py-1 text-xs"
          value={folder?.id ?? ""}
          onChange={(event) => fileHolding(row.id, event.target.value || null)}
          disabled={filing}
          title="Move this holding to another folder"
          aria-label={`Folder for ${row.name}`}
        >
          <option value="">No folder</option>
          {folders.map((item) => (
            <option key={item.id} value={item.id}>
              {folderLabel(item)}
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
        <span className="truncate">{folderLabel(folder)}</span>
      </span>
    );
  }

  /** Group heading shared by the table and the phone list. */
  function groupHeader(group: FolderGroup<HoldingRow>) {
    const key = group.folder.id;
    const isCollapsed = collapsedGroups.has(key);
    return (
      <button
        type="button"
        onClick={() => toggleGroup(key)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={!isCollapsed}
      >
        <span className="w-3 text-[10px] text-slate-400">{isCollapsed ? "▶" : "▼"}</span>
        <ExchangeIcon
          provider={group.folder.icon === "exchange" ? (group.folder.glyph as PriceProvider) : undefined}
          glyph={group.folder.icon === "emoji" ? group.folder.glyph : undefined}
          label={group.folder.name.slice(0, 1)}
          color={group.folder.color}
          className="h-4 w-4 rounded"
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {group.folder.name}
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

  /** One holding row in the desktop table. */
  function renderDesktopRow(r: HoldingRow) {
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
                      {hasFolders && !arranging && viewDragHandle(r, "mr-1 -ml-1")}
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
                          <SpamBadge row={r} />
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
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {r.spam ? <span className="text-slate-400">—</span> : money(r.value)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(r.pnl)}`}>
                    {isCash || r.spam ? (
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
                      <span className="w-12 text-right tabular-nums text-slate-600">
                        {r.spam ? "—" : `${(r.weight * 100).toFixed(1)}%`}
                      </span>
                    </div>
                  </td>
                </tr>
              );
  }

  /** One holding card in the phone list. */
  function renderMobileCard(r: HoldingRow) {
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
                    <SpamBadge row={r} />
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
                  <span className="block font-semibold tabular-nums text-slate-900">
                    {r.spam ? "—" : money(r.value)}
                  </span>
                  <span className={`block text-xs tabular-nums ${isCash || r.spam ? "text-slate-400" : pnlColor(r.pnl)}`}>
                    {isCash
                      ? "cash"
                      : r.spam
                        ? "not counted"
                        : `${money(r.pnl, { sign: true })} · ${r.cost > 0 ? pct(r.pnlPct) : "—"}`}
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
            <label
              className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500"
              title="Hide holdings worth less than this (dust) from the table"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-indigo-600"
                checked={hideDust}
                onChange={(event) => setHideDust(event.target.checked)}
              />
              <span className="shrink-0">Hide under</span>
              <span className="text-slate-400">$</span>
              <input
                className="input w-16 py-1 text-xs disabled:opacity-50"
                type="number"
                min={0}
                step="0.5"
                inputMode="decimal"
                value={dustThreshold}
                onChange={(event) => setDustThreshold(event.target.value)}
                disabled={!hideDust}
                aria-label="Hide holdings worth less than this many dollars"
              />
            </label>
          )}
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

      {filingError && (
        <p role="alert" className="mx-4 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {filingError}
        </p>
      )}

      {spamSplit.spamCount > 0 && (
        <p className="mx-4 mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {spamSplit.spamCount} holding{spamSplit.spamCount === 1 ? "" : "s"} look
          {spamSplit.spamCount === 1 ? "s" : ""} like spam and {spamSplit.spamCount === 1 ? "is" : "are"}{" "}
          hidden, and spam is never counted in the portfolio total.{" "}
          <button
            type="button"
            className="font-medium text-indigo-600 hover:underline"
            onClick={() => setShowSpam(true)}
          >
            Show them
          </button>
          {" · "}
          <button
            type="button"
            className="font-medium text-indigo-600 hover:underline disabled:opacity-50"
            disabled={removingSpam}
            onClick={() =>
              startRemovingSpam(async () => {
                const result = await removeSpamHoldings();
                setSpamCleanup(
                  result.removed > 0
                    ? `Removed ${result.removed} spam holding${result.removed === 1 ? "" : "s"}.`
                    : "Nothing left to remove.",
                );
                router.refresh();
              })
            }
          >
            {removingSpam ? "Removing…" : "Remove them"}
          </button>
        </p>
      )}

      {!removingSpam && spamSplit.spamCount === 0 && spamCleanup !== "" && (
        <p className="mx-4 mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{spamCleanup}</p>
      )}

      {dustSplit.dustCount > 0 && (
        <p className="mx-4 mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {dustSplit.dustCount} holding{dustSplit.dustCount === 1 ? "" : "s"} under{" "}
          {money(dustCut)} hidden ({money(dustSplit.dustValue)}).{" "}
          <button
            type="button"
            className="font-medium text-indigo-600 hover:underline"
            onClick={() => setHideDust(false)}
          >
            Show them
          </button>
        </p>
      )}

      <HoldingsFolders
        folders={rootFolders}
        allFolders={folders}
        assignments={assignments}
        counts={folderStats.counts}
        totals={folderStats.totals}
        totalRows={rows.length}
        selected={folderFilter}
        onSelect={setFolderFilter}
        arranging={arranging}
        onFoldersChange={(next) => setFolders([...next, ...nestedFolders])}
        onAssignmentsChange={setAssignments}
        onGroupsCleared={() => {
          clearAllGroupsState();
          setFolderFilter("all");
          setCollapsedGroups(new Set());
        }}
        onFileHolding={fileHolding}
      />

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
            {/* Holdings in no folder are plain rows, exactly as they were before
                folders existed — there is no "Unfiled" heading. */}
            {ungrouped.map((r) => renderDesktopRow(r))}
            {displayGroups.map((group) => {
              const groupKey = group.folder.id;
              const isCollapsed = collapsedGroups.has(groupKey);
              return (
                <Fragment key={groupKey}>
                  <tr
                    {...groupDropProps(groupKey)}
                    className={`border-l-2 transition ${
                      groupDrop === groupKey
                        ? "border-indigo-500 bg-indigo-50/70"
                        : "border-transparent bg-slate-50/60"
                    }`}
                  >
                    <th colSpan={columnCount} className="px-4 py-2 font-normal" scope="colgroup">
                      <span className="flex items-center gap-2">
                        {groupHeader(group)}
                        {rowDragging !== null && groupDrop === groupKey && (
                          <span className="rounded-md bg-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Drop to file here
                          </span>
                        )}
                      </span>
                    </th>
                  </tr>
                  {!isCollapsed && group.rows.map((r) => renderDesktopRow(r))}
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
        {ungrouped.map((r) => renderMobileCard(r))}
        {displayGroups.map((group) => {
          const groupKey = group.folder.id;
          const isCollapsed = collapsedGroups.has(groupKey);
          return (
            <Fragment key={groupKey}>
              <li
                {...groupDropProps(groupKey)}
                className={`border-l-2 px-4 py-2 transition ${
                  groupDrop === groupKey
                    ? "border-indigo-500 bg-indigo-50/70"
                    : "border-transparent bg-slate-50/60"
                }`}
              >
                {groupHeader(group)}
              </li>
              {!isCollapsed && group.rows.map((r) => renderMobileCard(r))}
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
