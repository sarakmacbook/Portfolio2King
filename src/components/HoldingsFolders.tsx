"use client";

import { useState, useTransition, type DragEvent } from "react";
import { clearAllHoldingGroups, createHoldingGroup } from "@/app/actions";
import { UNGROUPED_SECTION_KEY } from "@/lib/dashboard-order-db";
import {
  FOLDER_COLORS,
  MAX_FOLDERS,
  MAX_FOLDER_NAME_LENGTH,
  matchesFolderFilter,
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
 * its count and value. Inside arrange mode the chips become draggable (and
 * nudgeable with ◀ / ▶), can be renamed, recoloured, given an exchange or emoji
 * icon, and deleted — and a holding dragged from the table can be dropped
 * straight onto a folder to file it.
 *
 * Groups are created from the **＋ Add group** button inside arrange mode (a
 * quick name field that persists at once) or from the **Add holding** /
 * **Edit** forms ("Create a new folder…"); the normal-view strip only
 * filters. In arrange mode the strip also arranges where each block of rows
 * sits in the table: one pill per section — the folder groups and the
 * ungrouped rows — in top-to-bottom order, so a group can be moved above or
 * below the plain rows. Dropping a holding on the ungrouped pill pulls it out
 * of its folder. Filing goes through `onFileHolding`, so the table decides
 * whether a drop is pending (arrange mode, saved by **Save layout**) or
 * persisted straight away (normal view). Folder edits made in arrange mode
 * are deferred to that save; quick creation and section order are too.
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
  sections,
  onSectionsChange,
  ungroupedCount,
  onAssignmentsChange,
  onGroupsCleared,
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
  /** Section order for arrange mode: folder ids plus the ungrouped key. */
  sections: string[];
  onSectionsChange: (next: string[]) => void;
  /** Holdings in no folder — the count on the ungrouped pill. */
  ungroupedCount: number;
  onAssignmentsChange: (next: FolderAssignments) => void;
  onGroupsCleared: () => void;
  /** Files one holding (drag-and-drop); `null` pulls it out of its folder. */
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
  const [groupError, setGroupError] = useState("");
  const [clearError, setClearError] = useState("");
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [savingGroup, startSavingGroup] = useTransition();
  const [clearingGroups, startClearingGroups] = useTransition();

  /** The editor exists only while arranging; changes are saved with the layout. */
  const showEditor = arranging && editing !== null;
  /** The quick group form lives in the strip itself, in either mode. */
  const showQuickCreate = creating;

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setDraftName("");
    setGroupError("");
  }

  function commitQuickCreate() {
    if (savingGroup || !draftName.trim()) return;
    setGroupError("");
    startSavingGroup(async () => {
      const result = await createHoldingGroup(draftName);
      if (!result.ok || !result.folder) {
        setGroupError(result.error ?? "Could not create the group.");
        return;
      }
      onFoldersChange([...folders, result.folder]);
      setDraftName("");
      setCreating(false);
      setAnnouncement(`${result.folder.name} group created.`);
    });
  }

  function startEdit(folder: HoldingFolder) {
    setEditing(folder.id);
    setDraftName(folder.name);
    setDraftColor(folder.color);
    setDraftIcon(folder.icon);
    setDraftGlyph(folder.glyph);
  }

  function clearGroups() {
    if (clearingGroups) return;
    setClearError("");
    startClearingGroups(async () => {
      const result = await clearAllHoldingGroups();
      if (!result.ok) {
        setClearError(result.error ?? "Could not remove the groups.");
        return;
      }
      onGroupsCleared();
      setConfirmClearAll(false);
      setAnnouncement("All groups removed. Holdings remain in the portfolio and are now ungrouped.");
    });
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

  function sectionLabel(key: string) {
    if (key === UNGROUPED_SECTION_KEY) return "Ungrouped rows";
    return folders.find((folder) => folder.id === key)?.name ?? "Folder";
  }

  /** Nudges a section (a folder pill or the ungrouped block) left/right. */
  function moveSectionBy(key: string, delta: number) {
    const from = sections.indexOf(key);
    const to = Math.max(0, Math.min(sections.length - 1, from + delta));
    if (from < 0 || to === from) return;
    const next = [...sections];
    next.splice(from, 1);
    next.splice(to, 0, key);
    onSectionsChange(next);
    setAnnouncement(`${sectionLabel(key)} moved to position ${to + 1} of ${next.length}.`);
  }

  function handleSectionDrop() {
    if (!dragging || !drop || dragging === drop.id) {
      setDragging(null);
      setDrop(null);
      return;
    }
    const from = sections.indexOf(dragging);
    const target = sections.indexOf(drop.id);
    if (from < 0 || target < 0) {
      setDragging(null);
      setDrop(null);
      return;
    }
    const next = [...sections];
    next.splice(from, 1);
    const at = next.indexOf(drop.id) + (drop.after ? 1 : 0);
    next.splice(at, 0, dragging);
    onSectionsChange(next);
    setAnnouncement(
      `${sectionLabel(dragging)} moved to position ${at + 1} of ${next.length}.`,
    );
    setDragging(null);
    setDrop(null);
  }

  /** A holding dragged out of the table (text/plain = asset id) was dropped here. */
  function handleHoldingDrop(event: DragEvent<HTMLElement>, sectionKey: string) {
    const raw = event.dataTransfer.getData("text/plain");
    const assetId = Number(raw);
    if (!Number.isInteger(assetId) || assetId <= 0) return;
    event.preventDefault();
    // Dropping on the ungrouped block pulls the holding out of its folder.
    onFileHolding(assetId, sectionKey === UNGROUPED_SECTION_KEY ? null : sectionKey);
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

  /**
   * The solid create button — shown in the normal-view strip and again inside
   * arrange mode, so a group can be started without leaving the layout editor.
   * It persists at once in both modes (quick create is never pending).
   */
  function createButton() {
    if (creating) return null;
    return (
      <button
        type="button"
        className="btn-primary text-xs"
        onClick={startCreate}
        disabled={savingGroup || allFolders.length >= MAX_FOLDERS}
        title={`Create a group for holdings (up to ${MAX_FOLDERS})`}
      >
        ＋ Add group
      </button>
    );
  }

  /**
   * One pill per section while arranging: folder pills (drag, nudge, edit,
   * delete) plus the ungrouped-rows block, which moves like any other section
   * and doubles as a drop target that pulls a holding out of its folder. The
   * pill order is the table's top-to-bottom section order.
   */
  function sectionPill(key: string, position: number) {
    const folder =
      key === UNGROUPED_SECTION_KEY ? undefined : folders.find((item) => item.id === key);
    if (key !== UNGROUPED_SECTION_KEY && !folder) return null;
    const isDragging = dragging === key;
    const isDropTarget = drop?.id === key && !isDragging;
    const label = folder ? folder.name : "Ungrouped rows";
    const count = folder ? (counts[folder.id] ?? 0) : ungroupedCount;
    return (
      <div
        key={key}
        onDragOver={(event) => {
          if (dragging) {
            if (dragging === key) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            const after = event.clientX - rect.left > rect.width / 2;
            setDrop((current) =>
              current?.id === key && current.after === after ? current : { id: key, after },
            );
            return;
          }
          allowHoldingDrop(event, key);
        }}
        onDragLeave={() => setDropFolder((current) => (current === key ? null : current))}
        onDrop={(event) => {
          if (dragging) {
            event.preventDefault();
            handleSectionDrop();
            return;
          }
          handleHoldingDrop(event, key);
        }}
        className={`flex items-center gap-1 rounded-xl border border-dashed px-2 py-1 ${
          folder ? "border-indigo-300 bg-indigo-50/80" : "border-slate-300 bg-slate-50"
        } ${isDragging ? "opacity-50" : ""} ${
          isDropTarget || dropFolder === key
            ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-50"
            : ""
        }`}
      >
        <span
          draggable
          onDragStart={(event) => {
            setDragging(key);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", `section:${key}`);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDrop(null);
          }}
          className="flex cursor-grab items-center gap-1.5 text-xs font-medium text-indigo-900 active:cursor-grabbing"
          title={`Drag to move ${label}`}
        >
          <GripIcon className="h-3 w-2" />
          {folder ? (
            <ExchangeIcon
              provider={folder.icon === "exchange" ? (folder.glyph as PriceProvider) : undefined}
              glyph={folder.icon === "emoji" ? folder.glyph : undefined}
              label={folder.name.slice(0, 1)}
              color={folder.color}
              className="h-4 w-4 rounded"
            />
          ) : (
            <span aria-hidden="true" className="text-[10px]">
              ≡
            </span>
          )}
          <span className="max-w-24 truncate">{label}</span>
          <span className="text-[10px] tabular-nums text-indigo-700/70">{count}</span>
        </span>
        <span className="flex items-center">
          <button
            type="button"
            className="grid h-5 w-4 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
            onClick={() => moveSectionBy(key, -1)}
            disabled={position === 0}
            aria-label={`Move ${label} left`}
          >
            ◀
          </button>
          <button
            type="button"
            className="grid h-5 w-4 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
            onClick={() => moveSectionBy(key, 1)}
            disabled={position === sections.length - 1}
            aria-label={`Move ${label} right`}
          >
            ▶
          </button>
          {folder && (
            <>
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
            </>
          )}
        </span>
      </div>
    );
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

        {!arranging && allFolders.length > 0 && (
          <button
            type="button"
            className="rounded-xl border border-transparent px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:border-rose-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setClearError("");
              setConfirmClearAll(true);
            }}
            disabled={clearingGroups}
          >
            Remove all groups
          </button>
        )}

        {arranging && (
          <>
            {sections.map((key, position) => sectionPill(key, position))}
            {createButton()}
            {sections.length > 0 && (
              <span className="text-[11px] text-indigo-700/70">
                Drag a holding onto a folder to file it — drop it on Ungrouped rows to unfile
              </span>
            )}
          </>
        )}
      </div>

      {confirmClearAll && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-medium text-rose-900">
            Remove all {allFolders.length} groups, including folders inside asset pages?
          </p>
          <p className="mt-1 text-xs text-rose-800">
            Holdings will not be deleted; they will remain in your portfolio without groups.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary bg-rose-600 text-xs hover:bg-rose-700"
              onClick={clearGroups}
              disabled={clearingGroups}
            >
              {clearingGroups ? "Removing…" : "Remove all groups"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setConfirmClearAll(false)}
              disabled={clearingGroups}
            >
              Cancel
            </button>
          </div>
          {clearError && <p role="alert" className="mt-2 text-sm text-rose-800">{clearError}</p>}
        </div>
      )}

      {showQuickCreate && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input min-w-0 flex-1"
              placeholder="Group name (e.g. Long term, Retirement)"
              value={draftName}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitQuickCreate();
                }
                if (event.key === "Escape") setCreating(false);
              }}
              aria-label="New holdings group name"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={commitQuickCreate}
                disabled={savingGroup || !draftName.trim()}
              >
                {savingGroup ? "Creating…" : "Create group"}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setCreating(false);
                  setGroupError("");
                }}
                disabled={savingGroup}
              >
                Cancel
              </button>
            </div>
          </div>
          {groupError && <p role="alert" className="mt-2 text-sm text-rose-700">{groupError}</p>}
          <p className="mt-2 text-xs text-slate-500">
            The group will be added to Holdings now. You can file assets into it from the table.
          </p>
        </div>
      )}

      {showEditor && editing !== null && (
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
                  commitEdit(editing);
                }
                if (event.key === "Escape") setEditing(null);
              }}
              aria-label="Folder name"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => commitEdit(editing)}
              >
                Save folder
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setEditing(null)}
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
