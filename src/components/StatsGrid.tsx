"use client";

import { useState } from "react";
import {
  DASHBOARD_STATS,
  MAX_DASHBOARD_STAT_LABEL_LENGTH,
  moveStatBy,
  moveStatTo,
  type DashboardStatKey,
} from "@/lib/dashboard-stats";
import DailyPerformance, { type DailyPerformanceProps } from "./DailyPerformance";
import GripIcon from "./GripIcon";

export type StatCardData = {
  value: string;
  hint?: string;
  valueClass?: string;
  hintClass?: string;
};

/**
 * The four dashboard numbers. They keep their grid, and in "Arrange layout"
 * mode each card can be dragged left/right (or nudged with the arrows) inside
 * the row and given a custom label; both the order and labels are saved with
 * the rest of the dashboard layout.
 */
export default function StatsGrid({
  cards,
  dailyPerformance,
  order,
  onOrderChange,
  labels,
  onLabelChange,
  arranging,
}: {
  cards: Record<DashboardStatKey, StatCardData>;
  dailyPerformance: DailyPerformanceProps;
  order: DashboardStatKey[];
  onOrderChange: (next: DashboardStatKey[]) => void;
  labels: Record<DashboardStatKey, string>;
  onLabelChange: (key: DashboardStatKey, label: string) => void;
  arranging: boolean;
}) {
  const [dragging, setDragging] = useState<DashboardStatKey | null>(null);
  const [drop, setDrop] = useState<{ key: DashboardStatKey; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function clearDrag() {
    setDragging(null);
    setDrop(null);
  }

  function displayLabel(key: DashboardStatKey): string {
    const custom = labels[key]?.trim();
    return custom && custom.length > 0 ? custom : DASHBOARD_STATS[key].label;
  }

  function move(key: DashboardStatKey, delta: number) {
    const from = order.indexOf(key);
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    if (from < 0 || to === from) return;
    onOrderChange(moveStatBy(order, key, delta));
    setAnnouncement(`${displayLabel(key)} moved to position ${to + 1} of ${order.length}.`);
  }

  function handleDrop() {
    if (!dragging || !drop || dragging === drop.key) {
      clearDrag();
      return;
    }
    const next = moveStatTo(order, dragging, drop.key, drop.after);
    onOrderChange(next);
    setAnnouncement(
      `${displayLabel(dragging)} moved to position ${next.indexOf(dragging) + 1} of ${next.length}.`,
    );
    clearDrag();
  }

  return (
    <div className="space-y-2">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {order.map((key, position) => {
          const meta = DASHBOARD_STATS[key];
          const card = cards[key];
          const label = displayLabel(key);
          const isDragging = dragging === key;
          const isDropTarget = drop?.key === key && !isDragging;
          return (
            <div
              key={key}
              onDragOver={(event) => {
                if (!arranging || !dragging || dragging === key) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const after = event.clientX - rect.left > rect.width / 2;
                setDrop((current) =>
                  current?.key === key && current.after === after ? current : { key, after },
                );
              }}
              onDrop={(event) => {
                if (!arranging) return;
                event.preventDefault();
                handleDrop();
              }}
              className={`min-w-0 ${isDragging ? "opacity-50" : ""} ${
                isDropTarget ? "rounded-2xl ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-50" : ""
              }`}
            >
              {arranging && (
                <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1">
                  <span
                    draggable
                    onDragStart={(event) => {
                      setDragging(key);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", key);
                    }}
                    onDragEnd={clearDrag}
                    className="flex min-w-0 cursor-grab items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-900 active:cursor-grabbing"
                    title="Drag to move this card"
                  >
                    <GripIcon className="h-3 w-2" />
                    <span className="truncate">{label}</span>
                  </span>
                  <span className="ml-auto flex">
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => move(key, -1)}
                      disabled={position === 0}
                      aria-label={`Move ${label} left`}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => move(key, 1)}
                      disabled={position === order.length - 1}
                      aria-label={`Move ${label} right`}
                    >
                      ▶
                    </button>
                  </span>
                </div>
              )}
              <div className="card p-4">
                {arranging ? (
                  <input
                    type="text"
                    value={labels[key] ?? ""}
                    placeholder={meta.label}
                    maxLength={MAX_DASHBOARD_STAT_LABEL_LENGTH}
                    aria-label={`${meta.label} label`}
                    onChange={(event) => onLabelChange(key, event.target.value)}
                    className="input px-2.5 py-1 text-xs font-medium uppercase tracking-wide"
                  />
                ) : (
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                )}
                {key === "realized" ? <DailyPerformance {...dailyPerformance} /> : <>
                <p
                  className={`mt-2 truncate text-lg font-semibold tabular-nums sm:text-xl ${
                    card.valueClass ?? "text-slate-900"
                  }`}
                >
                  {card.value}
                </p>
                {card.hint && (
                  <p className={`mt-0.5 text-xs ${card.hintClass ?? "text-slate-500"}`}>{card.hint}</p>
                )}
                </>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
