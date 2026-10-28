"use client";

import { useState, type DragEvent } from "react";
import {
  FOLDER_COLORS,
  MAX_FOLDERS,
  MAX_FOLDER_NAME_LENGTH,
  makeFolder,
  matchesFolderFilter,
  moveFolderBy,
  moveFolderTo,
  removeFolder,
  updateFolder,
  type FolderAssignments,
  type FolderFilter,
  type FolderIconKind,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { PRICE_PROVIDERS, PROVIDER_LABELS, type PriceProvider } from "@/lib/market-prices";
import { money } from "@/lib/format";
import ExchangeIcon from "./ExchangeIcon";
import GripIcon from "./GripIcon";

/**
 * The folder strip above the Holdings table.
 *
 * Outside arrange mode it is a filter bar: **All** and one chip per folder with
 * its count and value. Inside arrange mode the chips become
 * draggable (and nudgeable with ◀ / ▶), can be renamed, recoloured, given an
 * exchange or emoji icon, and deleted — and a holding dragged from the table can
 * be dropped straight onto a folder to file it.
 *
 * Filing goes through `onFileHolding`, so the table decides whether a drop is
 * pending (arrange mode, saved by **Save layout**) or persisted straight away
 * (normal view). Editing folders themselves is always deferred to that save.
 */
export default function HoldingsFolders({
  folders,
  allFolders,
  assignments,
  counts,
  totals,
  selected,
  onSelect,
  arranging,
  onFoldersChange,
  onAssignmentsChange,
  onFileHolding,
  totalRows,
}: {
  folders: HoldingFolder[];
  /** Full inventory, including folders nested under assets. */
  allFolders: HoldingFolder[];
  assignments: FolderAssignments;
  /** Holdings per folder id. */
  counts: Record<string, number>;
  /** Portfolio value per folder id. */
  totals: Record<string, number>;
  selected: FolderFilter;
  onSelect: (next: FolderFilter) => void;
  arranging: boolean;
  onFoldersChange: (next: HoldingFolder[]) => void;
  onAssignmentsChange: (next: FolderAssignments) => void;
  /** Files one holding (drag-and-drop); persisted at once outside arrange mode. */
  onFileHolding: (assetId: number, folderId: string | null) => void;
  /** Total number of holdings, shown on the **All** chip. */
  totalRows: number;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<string>(FOLDER_COLORS[0]);
  const [draftIcon, setDraftIcon] = useState<FolderIconKind>("auto");
  const [draftGlyph, setDraftGlyph] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /** The editor exists only while arranging; changes are saved with the layout. */
  const showEditor = arranging && (creating || editing !== null);

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setDraftName("");
    setDraftColor(FOLDER_COLORS[allFolders.length % FOLDER_COLORS.length]);
    setDraftIcon("auto");
    setDraftGlyph("");
  }

  function startEdit(folder: HoldingFolder) {
    setEditing(folder.id);
    setCreating(false);
    setDraftName(folder.name);
    setDraftColor(folder.color);
    setDraftIcon(folder.icon);
    setDraftGlyph(folder.glyph);
  }

  function commitCreate() {
    const folder = makeFolder(
      { name: draftName, color: draftColor, icon: draftIcon, glyph: draftGlyph },
      allFolders,
    );
    if (!folder) {
      setAnnouncement(
        draftName.trim()
          ? `You can have at most ${MAX_FOLDERS} folders.`
          : "Give the folder a name first.",
      );
      return;
    }
    onFoldersChange([...folders, folder]);
    setAnnouncement(`${folder.name} folder created.`);
    setCreating(false);
  }

  function commitEdit(id: string) {
    onFoldersChange(
      updateFolder(folders, id, {
        name: draftName,
        color: draftColor,
        icon: draftIcon,
        glyph: draftGlyph,
      }),
    );
    setAnnouncement(`${draftName.trim() || "Folder"} updated.`);
    setEditing(null);
  }

  function deleteFolder(folder: HoldingFolder) {
    const { folders: nextFolders, assignments: nextAssignments } = removeFolder(
      folders,
      assignments,
      folder.id,
    );
    onFoldersChange(nextFolders);
    onAssignmentsChange(nextAssignments);
    if (selected === `folder:${folder.id}`) onSelect("all");
    setAnnouncement(`${folder.name} deleted. Its holdings are back in the list.`);
    setEditing(null);
  }

  function move(id: string, delta: number) {
    const from = folders.findIndex((folder) => folder.id === id);
    const to = Math.max(0, Math.min(folders.length - 1, from + delta));
    if (from < 0 || to === from) return;
    onFoldersChange(moveFolderBy(folders, id, delta));
    setAnnouncement(`${folders[from].name} moved to position ${to + 1} of ${folders.length}.`);
  }

  function handleFolderDrop() {
    if (!dragging || !drop || dragging === drop.id) {
      setDragging(null);
      setDrop(null);
      return;
    }
    const next = moveFolderTo(folders, dragging, drop.id, drop.after);
    onFoldersChange(next);
    setAnnouncement(
      `${folders.find((folder) => folder.id === dragging)?.name ?? "Folder"} moved to position ${
        next.findIndex((folder) => folder.id === dragging) + 1
      } of ${next.length}.`,
    );
    setDragging(null);
    setDrop(null);
  }

  /** A holding dragged out of the table (text/plain = asset id) was dropped here. */
  function handleHoldingDrop(event: DragEvent<HTMLElement>, folderId: string) {
    const raw = event.dataTransfer.getData("text/plain");
    const assetId = Number(raw);
    if (!Number.isInteger(assetId) || assetId <= 0) return;
    event.preventDefault();
    onFileHolding(assetId, folderId);
    setDropFolder(null);
  }

  function allowHoldingDrop(event: DragEvent<HTMLElement>, folderId: string) {
    // Only react to holdings: a folder or category drag carries its own key.
    const raw = event.dataTransfer.types.includes("text/plain");
    if (!raw) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropFolder(folderId);
  }

  const chipClass = (active: boolean) =>
    `group flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
      active
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
    }`;

  return (
    <div className="border-b border-slate-100 px-4 pb-3">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {!arranging && (
          <>
            {folders.length > 0 && (
              <button
                type="button"
                onClick={() => onSelect("all")}
                className={chipClass(selected === "all")}
                aria-pressed={selected === "all"}
              >
                All
                <span className={selected === "all" ? "opacity-70" : "text-slate-400"}>{totalRows}</span>
              </button>
            )}
            {folders.map((folder) => {
              const value = `folder:${folder.id}`;
              const active = selected === value;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => onSelect(active ? "all" : (value as FolderFilter))}
                  className={chipClass(active)}
                  aria-pressed={active}
                  title={`${folder.name} · ${money(totals[folder.id] ?? 0)}`}
                  onDragOver={(event) => allowHoldingDrop(event, folder.id)}
                  onDragLeave={() => setDropFolder((current) => (current === folder.id ? null : current))}
                  onDrop={(event) => handleHoldingDrop(event, folder.id)}
                >
                  <ExchangeIcon
                    provider={folder.icon === "exchange" ? (folder.glyph as PriceProvider) : undefined}
                    glyph={folder.icon === "emoji" ? folder.glyph : undefined}
                    label={folder.name.slice(0, 1)}
                    color={folder.color}
                    className={`h-4 w-4 rounded ${
                      dropFolder === folder.id ? "ring-2 ring-indigo-400" : ""
                    }`}
                  />
                  <span className="max-w-28 truncate">{folder.name}</span>
                  <span className={active ? "opacity-70" : "text-slate-400"}>
                    {counts[folder.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </>
        )}

        {arranging && (
          <>
            {folders.map((folder, position) => {
              const isDragging = dragging === folder.id;
              const isDropTarget = drop?.id === folder.id && !isDragging;
              return (
                <div
                  key={folder.id}
                  onDragOver={(event) => {
                    if (dragging) {
                      if (dragging === folder.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const rect = event.currentTarget.getBoundingClientRect();
                      const after = event.clientX - rect.left > rect.width / 2;
                      setDrop((current) =>
                        current?.id === folder.id && current.after === after
                          ? current
                          : { id: folder.id, after },
                      );
                      return;
                    }
                    allowHoldingDrop(event, folder.id);
                  }}
                  onDragLeave={() => setDropFolder((current) => (current === folder.id ? null : current))}
                  onDrop={(event) => {
                    if (dragging) {
                      event.preventDefault();
                      handleFolderDrop();
                      return;
                    }
                    handleHoldingDrop(event, folder.id);
                  }}
                  className={`flex items-center gap-1 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/80 px-2 py-1 ${
                    isDragging ? "opacity-50" : ""
                  } ${
                    isDropTarget || dropFolder === folder.id
                      ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-50"
                      : ""
                  }`}
                >
                  <span
                    draggable
                    onDragStart={(event) => {
                      setDragging(folder.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", `folder:${folder.id}`);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDrop(null);
                    }}
                    className="flex cursor-grab items-center gap-1.5 text-xs font-medium text-indigo-900 active:cursor-grabbing"
                    title="Drag to move this folder"
                  >
                    <GripIcon className="h-3 w-2" />
                    <ExchangeIcon
                      provider={folder.icon === "exchange" ? (folder.glyph as PriceProvider) : undefined}
                      glyph={folder.icon === "emoji" ? folder.glyph : undefined}
                      label={folder.name.slice(0, 1)}
                      color={folder.color}
                      className="h-4 w-4 rounded"
                    />
                    <span className="max-w-24 truncate">{folder.name}</span>
                    <span className="text-[10px] tabular-nums text-indigo-700/70">
                      {counts[folder.id] ?? 0}
                    </span>
                  </span>
                  <span className="flex items-center">
                    <button
                      type="button"
                      className="grid h-5 w-4 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => move(folder.id, -1)}
                      disabled={position === 0}
                      aria-label={`Move ${folder.name} left`}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="grid h-5 w-4 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
                      onClick={() => move(folder.id, 1)}
                      disabled={position === folders.length - 1}
                      aria-label={`Move ${folder.name} right`}
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white"
                      onClick={() => startEdit(folder)}
                      aria-label={`Edit ${folder.name}`}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="grid h-5 w-5 place-items-center rounded text-[10px] text-rose-600 hover:bg-white"
                      onClick={() => deleteFolder(folder)}
                      aria-label={`Delete ${folder.name}`}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              );
            })}
            <button
              type="button"
              className="rounded-xl border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
              onClick={startCreate}
              disabled={allFolders.length >= MAX_FOLDERS}
              title={`Group holdings into folders (up to ${MAX_FOLDERS})`}
            >
              ＋ New folder
            </button>
            {folders.length > 0 && (
              <span className="text-[11px] text-indigo-700/70">
                Drag a holding onto a folder to file it
              </span>
            )}
          </>
        )}
      </div>

      {showEditor && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input min-w-0 flex-1"
              placeholder="Folder name (e.g. Long term, Binance, Play money)"
              value={draftName}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (editing) commitEdit(editing);
                  else commitCreate();
                }
                if (event.key === "Escape") {
                  setEditing(null);
                  setCreating(false);
                }
              }}
              aria-label="Folder name"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => (editing ? commitEdit(editing) : commitCreate())}
              >
                {editing ? "Save folder" : "Create folder"}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Colour</span>
            <span className="flex flex-wrap gap-1">
              {FOLDER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setDraftColor(color)}
                  className={`h-5 w-5 rounded-full ring-offset-2 ${
                    draftColor === color ? "ring-2 ring-indigo-500" : ""
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Use colour ${color}`}
                  aria-pressed={draftColor === color}
                />
              ))}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Icon</span>
            <button
              type="button"
              onClick={() => {
                setDraftIcon("auto");
                setDraftGlyph("");
              }}
              className={`rounded-lg border px-2 py-1 text-[11px] ${
                draftIcon === "auto" ? "border-indigo-500 text-slate-900" : "border-slate-200 text-slate-500"
              }`}
              aria-pressed={draftIcon === "auto"}
            >
              Letter
            </button>
            {PRICE_PROVIDERS.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => {
                  setDraftIcon("exchange");
                  setDraftGlyph(provider);
                }}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] ${
                  draftIcon === "exchange" && draftGlyph === provider
                    ? "border-indigo-500 text-slate-900"
                    : "border-slate-200 text-slate-500"
                }`}
                aria-pressed={draftIcon === "exchange" && draftGlyph === provider}
                title={`Use the ${PROVIDER_LABELS[provider]} logo`}
              >
                <ExchangeIcon provider={provider} color={draftColor} className="h-4 w-4 rounded" />
                {PROVIDER_LABELS[provider]}
              </button>
            ))}
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <span>Custom</span>
              <input
                className="input w-16 py-1 text-center text-sm"
                value={draftIcon === "emoji" ? draftGlyph : ""}
                onChange={(event) => {
                  setDraftIcon(event.target.value ? "emoji" : "auto");
                  setDraftGlyph(event.target.value.slice(0, 4));
                }}
                placeholder="🏦"
                maxLength={4}
                aria-label="Custom folder icon (emoji or short text)"
              />
            </label>
            <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
              Preview
              <ExchangeIcon
                provider={draftIcon === "exchange" ? (draftGlyph as PriceProvider) : undefined}
                glyph={draftIcon === "emoji" ? draftGlyph : undefined}
                label={draftName.trim().slice(0, 1) || "F"}
                color={draftColor}
                className="h-6 w-6 rounded-md"
              />
            </span>
          </div>
        </div>
      )}

    </div>
  );
}

export { matchesFolderFilter };
