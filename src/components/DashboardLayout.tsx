"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { resetDashboardLayout, saveDashboardLayout, type ActionState } from "@/app/actions";
import {
  DASHBOARD_BLOCKS,
  DEFAULT_DASHBOARD_ORDER,
  moveBlockBy,
  moveBlockTo,
  type DashboardBlockKey,
} from "@/lib/dashboard-layout";
import {
  DEFAULT_DASHBOARD_STAT_LABELS,
  DEFAULT_DASHBOARD_STAT_ORDER,
  normaliseDashboardStatLabels,
  type DashboardStatKey,
} from "@/lib/dashboard-stats";
import { DEFAULT_HOLDING_FILTER_ORDER, type HoldingFilter } from "@/lib/holdings-filter";
import type { FolderAssignments, HoldingFolder } from "@/lib/holdings-folders";
import GripIcon from "./GripIcon";
import { HoldingsArrangeProvider } from "./holdings-arrange";
import type { DailyPerformanceProps } from "./DailyPerformance";
import StatsGrid, { type StatCardData } from "./StatsGrid";

/** Column spans so the two charts stay side by side when they are adjacent. */
const SPAN: Record<DashboardBlockKey, string> = {
  stats: "lg:col-span-5",
  holdings: "lg:col-span-5",
  history: "lg:col-span-3",
  allocation: "lg:col-span-2",
  activity: "lg:col-span-5",
};

/**
 * Wraps the dashboard cards so they can be moved up/down as whole blocks.
 * The order is saved server-side (`app_settings.dashboard.order`) only when the
 * user clicks **Save layout**. The same mode also arranges what lives *inside*
 * two of the cards — the stat row and the Holdings card (its category tabs and
 * its asset rows) — and the holdings table reads the pending orders through
 * `HoldingsArrangeProvider`.
 */
export default function DashboardLayout({
  blocks,
  statsCards,
  dailyPerformance,
  initialOrder = DEFAULT_DASHBOARD_ORDER,
  initialStatsOrder = DEFAULT_DASHBOARD_STAT_ORDER,
  initialStatsLabels = DEFAULT_DASHBOARD_STAT_LABELS,
  initialCategoryOrder = DEFAULT_HOLDING_FILTER_ORDER,
  initialAssetOrder = [],
  initialFolders = [],
  initialAssignments = {},
}: {
  blocks: Record<Exclude<DashboardBlockKey, "stats">, ReactNode>;
  /** Values and hints for the four stat cards, keyed by stat id. */
  statsCards: Record<DashboardStatKey, StatCardData>;
  dailyPerformance: DailyPerformanceProps;
  initialOrder?: DashboardBlockKey[];
  initialStatsOrder?: DashboardStatKey[];
  initialStatsLabels?: Record<DashboardStatKey, string>;
  /** Saved left-to-right order of the Holdings category tabs. */
  initialCategoryOrder?: HoldingFilter[];
  /** Saved top-to-bottom order of the holdings, as asset ids (empty = default). */
  initialAssetOrder?: number[];
  /** Saved Holdings folders. */
  initialFolders?: HoldingFolder[];
  /** Saved folder filing, `assetId → folderId`. */
  initialAssignments?: FolderAssignments;
}) {
  const [order, setOrder] = useState<DashboardBlockKey[]>(initialOrder);
  const [statsOrder, setStatsOrder] = useState<DashboardStatKey[]>(initialStatsOrder);
  const [statsLabels, setStatsLabels] = useState<Record<DashboardStatKey, string>>(initialStatsLabels);
  const [categoryOrder, setCategoryOrder] = useState<HoldingFilter[]>(initialCategoryOrder);
  const [assetOrder, setAssetOrder] = useState<number[]>(initialAssetOrder);
  const [folders, setFolders] = useState<HoldingFolder[]>(initialFolders);
  const [assignments, setAssignments] = useState<FolderAssignments>(initialAssignments);
  const [arranging, setArranging] = useState(false);
  const [dragging, setDragging] = useState<DashboardBlockKey | null>(null);
  const [drop, setDrop] = useState<{ key: DashboardBlockKey; after: boolean } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saving, startSaving] = useTransition();
  const savedOrder = useRef<DashboardBlockKey[]>(initialOrder);
  const savedStatsOrder = useRef<DashboardStatKey[]>(initialStatsOrder);
  const savedStatsLabels = useRef<Record<DashboardStatKey, string>>(initialStatsLabels);
  const savedCategoryOrder = useRef<HoldingFilter[]>(initialCategoryOrder);
  const savedAssetOrder = useRef<number[]>(initialAssetOrder);
  const savedFolders = useRef<HoldingFolder[]>(initialFolders);
  const savedAssignments = useRef<FolderAssignments>(initialAssignments);

  const holdingsArrange = useMemo(
    () => ({
      arranging,
      categoryOrder,
      onCategoryOrderChange: setCategoryOrder,
      assetOrder,
      onAssetOrderChange: setAssetOrder,
      folders,
      onFoldersChange: setFolders,
      onClearGroups: () => {
        setFolders([]);
        setAssignments({});
        savedFolders.current = [];
        savedAssignments.current = {};
      },
      assignments,
      onAssignmentsChange: setAssignments,
    }),
    [arranging, categoryOrder, assetOrder, folders, assignments],
  );

  function clearDrag() {
    setDragging(null);
    setDrop(null);
  }

  function startArranging() {
    savedOrder.current = order;
    savedStatsOrder.current = statsOrder;
    savedStatsLabels.current = statsLabels;
    savedCategoryOrder.current = categoryOrder;
    savedAssetOrder.current = assetOrder;
    savedFolders.current = folders;
    savedAssignments.current = assignments;
    setNotice(null);
    setArranging(true);
  }

  function cancelArranging() {
    setOrder(savedOrder.current);
    setStatsOrder(savedStatsOrder.current);
    setStatsLabels(savedStatsLabels.current);
    setCategoryOrder(savedCategoryOrder.current);
    setAssetOrder(savedAssetOrder.current);
    setFolders(savedFolders.current);
    setAssignments(savedAssignments.current);
    clearDrag();
    setArranging(false);
  }

  function updateStatLabel(key: DashboardStatKey, label: string) {
    setStatsLabels((current) => ({ ...current, [key]: label }));
  }

  function move(key: DashboardBlockKey, delta: number) {
    const from = order.indexOf(key);
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    if (from < 0 || to === from) return;
    setOrder(moveBlockBy(order, key, delta));
    setAnnouncement(`${DASHBOARD_BLOCKS[key].label} moved to position ${to + 1} of ${order.length}.`);
  }

  function handleDrop() {
    if (!dragging || !drop || dragging === drop.key) {
      clearDrag();
      return;
    }
    const next = moveBlockTo(order, dragging, drop.key, drop.after);
    setOrder(next);
    setAnnouncement(`${DASHBOARD_BLOCKS[dragging].label} moved to position ${next.indexOf(dragging) + 1} of ${next.length}.`);
    clearDrag();
  }

  function save() {
    const payload = JSON.stringify(order);
    const normalisedLabels = normaliseDashboardStatLabels(statsLabels);
    startSaving(async () => {
      const fd = new FormData();
      fd.set("order", payload);
      fd.set("statsOrder", JSON.stringify(statsOrder));
      fd.set("statsLabels", JSON.stringify(normalisedLabels));
      fd.set("holdingCategories", JSON.stringify(categoryOrder));
      fd.set("holdingOrder", JSON.stringify(assetOrder));
      fd.set("holdingFolders", JSON.stringify(folders));
      fd.set("holdingFolderAssignments", JSON.stringify(assignments));
      const result: ActionState = await saveDashboardLayout({}, fd);
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setStatsLabels(normalisedLabels);
      savedOrder.current = order;
      savedStatsOrder.current = statsOrder;
      savedStatsLabels.current = normalisedLabels;
      savedCategoryOrder.current = categoryOrder;
      savedAssetOrder.current = assetOrder;
      savedFolders.current = folders;
      savedAssignments.current = assignments;
      setArranging(false);
      setNotice({ kind: "ok", text: result.message ?? "Dashboard layout saved." });
    });
  }

  function reset() {
    startSaving(async () => {
      const result = await resetDashboardLayout({}, new FormData());
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setOrder(DEFAULT_DASHBOARD_ORDER);
      setStatsOrder(DEFAULT_DASHBOARD_STAT_ORDER);
      setStatsLabels(DEFAULT_DASHBOARD_STAT_LABELS);
      setCategoryOrder(DEFAULT_HOLDING_FILTER_ORDER);
      setAssetOrder([]);
      setFolders([]);
      setAssignments({});
      savedOrder.current = DEFAULT_DASHBOARD_ORDER;
      savedStatsOrder.current = DEFAULT_DASHBOARD_STAT_ORDER;
      savedStatsLabels.current = DEFAULT_DASHBOARD_STAT_LABELS;
      savedCategoryOrder.current = DEFAULT_HOLDING_FILTER_ORDER;
      savedAssetOrder.current = [];
      savedFolders.current = [];
      savedAssignments.current = {};
      clearDrag();
      setArranging(false);
      setNotice({ kind: "ok", text: result.message ?? "Dashboard layout reset to the default." });
    });
  }

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {notice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${
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

      <div className="flex flex-wrap items-center justify-end gap-2">
        {arranging ? (
          <>
            <p className="mr-auto text-xs font-medium text-indigo-700">
              Drag a card header to move it, use ▲ / ▼ or ◀ / ▶, shuffle the stat cards, the Holdings
              category tabs, folders and the holdings themselves, file a holding into a folder, and edit
              any stat label. Nothing changes until you save — but outside this mode you can drag a
              holding straight onto a folder and it is saved immediately.
            </p>
            <button type="button" className="btn-ghost" onClick={cancelArranging} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-ghost" onClick={reset} disabled={saving}>
              Reset to default
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save layout"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={startArranging}
              title="Move the dashboard cards up or down"
            >
              ⇅ Arrange layout
            </button>
          </>
        )}
      </div>

      <HoldingsArrangeProvider value={holdingsArrange}>
        <div className="grid gap-6 lg:grid-flow-row-dense lg:grid-cols-5">
          {order.map((key) => {
            const meta = DASHBOARD_BLOCKS[key];
            const isDragging = dragging === key;
            const isDropTarget = drop?.key === key && !isDragging;
            const position = order.indexOf(key);
            return (
              <div
                key={key}
                onDragOver={(event) => {
                  if (!arranging || !dragging || dragging === key) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const rect = event.currentTarget.getBoundingClientRect();
                  const after = event.clientY - rect.top > rect.height / 2;
                  setDrop((current) =>
                    current?.key === key && current.after === after ? current : { key, after },
                  );
                }}
                onDrop={(event) => {
                  if (!arranging) return;
                  event.preventDefault();
                  handleDrop();
                }}
                className={`min-w-0 ${SPAN[key]} ${isDragging ? "opacity-50" : ""} ${
                  isDropTarget ? "rounded-2xl ring-2 ring-indigo-400 ring-offset-4 ring-offset-slate-50" : ""
                }`}
              >
                {arranging && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/80 px-3 py-2">
                    <span
                      draggable
                      onDragStart={(event) => {
                        setDragging(key);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", key);
                      }}
                      onDragEnd={clearDrag}
                      className="flex cursor-grab items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-900 active:cursor-grabbing"
                      title="Drag to move this card"
                    >
                      <GripIcon />
                      {meta.label}
                    </span>
                    <span className="hidden text-[11px] text-indigo-700/70 sm:inline">{meta.hint}</span>
                    <span className="ml-auto flex flex-col">
                      <button
                        type="button"
                        className="grid h-4 w-6 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                        onClick={() => move(key, -1)}
                        disabled={position === 0}
                        aria-label={`Move ${meta.label} up`}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="grid h-4 w-6 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                        onClick={() => move(key, 1)}
                        disabled={position === order.length - 1}
                        aria-label={`Move ${meta.label} down`}
                      >
                        ▼
                      </button>
                    </span>
                  </div>
                )}
                <div className={arranging ? "rounded-2xl ring-2 ring-indigo-200/80" : ""}>
                  {key === "stats" ? (
                    <StatsGrid
                      cards={statsCards}
                      dailyPerformance={dailyPerformance}
                      order={statsOrder}
                      onOrderChange={setStatsOrder}
                      labels={statsLabels}
                      onLabelChange={updateStatLabel}
                      arranging={arranging}
                    />
                  ) : (
                    blocks[key]
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </HoldingsArrangeProvider>
    </div>
  );
}
