"use client";

import { useState, type ReactNode } from "react";
import {
  DASHBOARD_STATS,
  moveStatBy,
  moveStatTo,
  type DashboardStatKey,
} from "@/lib/dashboard-stats";

function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" className="h-3 w-2 fill-current" aria-hidden="true">
      <circle cx="2" cy="3" r="1.3" />
      <circle cx="8" cy="3" r="1.3" />
      <circle cx="2" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="2" cy="13" r="1.3" />
      <circle cx="8" cy="13" r="1.3" />
    </svg>
  );
}

/**
 * The four dashboard numbers. They keep their grid, but in "Arrange layout"
 * mode each card can be dragged left/right (or nudged with the arrows) inside
 * the row; the order is saved with the rest of the dashboard layout.
 *
 * The cards themselves are rendered on the server and handed in as nodes, so
 * the numbers, colours and formatting stay in one place.
 */
export default function StatsGrid({
  cards,
  order,
  onOrderChange,
  arranging,
}: {
  cards: Record<DashboardStatKey, ReactNode>;
  order: DashboardStatKey[];
  onOrderChange: (next: DashboardStatKey[]) => void;
  arranging: boolean;
}) {
  const [dragging, setDragging] = useState<DashboardStatKey | null>(null);
  const [drop, setDrop] = useState<{ key: DashboardStatKey; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function clearDrag() {
    setDragging(null);
    setDrop(null);
  }

  function move(key: DashboardStatKey, delta: number) {
    const from = order.indexOf(key);
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    if (from < 0 || to === from) return;
    onOrderChange(moveStatBy(order, key, delta));
    setAnnouncement(`${DASHBOARD_STATS[key].label} moved to position ${to + 1} of ${order.length}.`);
  }

  function handleDrop() {
    if (!dragging || !drop || dragging === drop.key) {
      clearDrag();
      return;
    }
    const next = moveStatTo(order, dragging, drop.key, drop.after);
    onOrderChange(next);
    setAnnouncement(
      `${DASHBOARD_STATS[dragging].label} moved to position ${next.indexOf(dragging) + 1} of ${next.length}.`,
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
                    <GripIcon />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="ml-auto flex">
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => move(key, -1)}
                      disabled={position === 0}
                      aria-label={`Move ${meta.label} left`}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => move(key, 1)}
                      disabled={position === order.length - 1}
                      aria-label={`Move ${meta.label} right`}
                    >
                      ▶
                    </button>
                  </span>
                </div>
              )}
              {cards[key]}
            </div>
          );
        })}
      </div>
    </div>
  );
}
