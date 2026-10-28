/**
 * Holdings folders.
 *
 * A holding can be filed into one folder ("Long term", "Binance", "Play money")
 * so a large portfolio reads as a handful of groups instead of one long table.
 * Folders are labels, not duplicate assets: a nested folder can be owned by a
 * holding's detail page, and each holding keeps its own quantity, price and P/L.
 *
 * Two `app_settings` keys hold the state:
 *
 * - `holdings.folders` — a JSON array of folders; the array order is the display
 *   order (folders can be dragged/renamed/coloured, like the holdings rows).
 * - `holdings.folderAssignments` — a JSON map of `assetId → folderId`.
 *
 * Everything here is pure — see tests/holdings-folders.test.ts.
 */
import { PRICE_PROVIDERS, type PriceProvider } from "@/lib/market-prices";

export const MAX_FOLDERS = 20;
export const MAX_FOLDER_NAME_LENGTH = 28;

/** Folder colours, picked so they read on both light and dark backgrounds. */
export const FOLDER_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#64748b",
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number];

/** Folder icons: an exchange mark, an emoji, or the first letter of the name. */
export type FolderIconKind = "auto" | "exchange" | "emoji";

export type HoldingFolder = {
  id: string;
  name: string;
  color: string;
  icon: FolderIconKind;
  /** Emoji for `icon: "emoji"`, exchange id for `icon: "exchange"`, else "". */
  glyph: string;
  /** Remembered collapse state on the dashboard. */
  collapsed: boolean;
  /** When set, this folder is nested inside the corresponding holding's page. */
  parentAssetId?: number;
};

/** asset id → folder id */
export type FolderAssignments = Record<number, string>;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function readString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isColor(value: string): boolean {
  return FOLDER_COLORS.includes(value as FolderColor);
}

function isPriceProvider(value: string): value is PriceProvider {
  return (PRICE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Accepts a stored value — JSON array, JSON string, or array — and returns the
 * folders the app can render: known ids only, no duplicates, names and colours
 * clamped, icons validated. Anything unreadable becomes an empty list.
 */
export function normaliseFolders(value: unknown): HoldingFolder[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const folders: HoldingFolder[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = readString(item.id, 32).toLowerCase();
    if (!ID_PATTERN.test(id) || seen.has(id)) continue;
    const name = readString(item.name, MAX_FOLDER_NAME_LENGTH);
    if (!name) continue;

    const color = readString(item.color, 16);
    const icon = readString(item.icon, 16);
    const glyph = readString(item.glyph, 8);
    const parentAssetId = Number(item.parentAssetId);
    const iconKind: FolderIconKind =
      icon === "exchange" && isPriceProvider(glyph)
        ? "exchange"
        : icon === "emoji" && glyph
          ? "emoji"
          : "auto";

    seen.add(id);
    folders.push({
      id,
      name,
      color: isColor(color) ? color : FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
      icon: iconKind,
      glyph: iconKind === "auto" ? "" : glyph,
      collapsed: item.collapsed === true,
      ...(Number.isInteger(parentAssetId) && parentAssetId > 0 ? { parentAssetId } : {}),
    });
    if (folders.length >= MAX_FOLDERS) break;
  }
  return folders;
}

/**
 * Accepts a stored `assetId → folderId` map (object or JSON string) and keeps
 * only positive asset ids pointing at one of `folderIds`.
 */
export function normaliseAssignments(
  value: unknown,
  folderIds: readonly string[],
): FolderAssignments {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const known = new Set(folderIds);
  const assignments: FolderAssignments = {};
  for (const [rawId, rawFolder] of Object.entries(parsed as Record<string, unknown>)) {
    const assetId = Number(rawId);
    const folderId = readString(rawFolder, 32).toLowerCase();
    if (!Number.isInteger(assetId) || assetId <= 0) continue;
    if (!known.has(folderId)) continue;
    assignments[assetId] = folderId;
  }
  return assignments;
}

/** A folder id that is not taken yet, derived from the name. */
export function nextFolderId(name: string, existing: readonly string[]): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "folder";
  const taken = new Set(existing);
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`.slice(0, 32);
}

/** Builds a folder, clamping the name and picking the next free colour. */
export function makeFolder(
  input: { name: string; color?: string; icon?: FolderIconKind; glyph?: string; parentAssetId?: number },
  existing: readonly HoldingFolder[],
): HoldingFolder | null {
  if (existing.length >= MAX_FOLDERS) return null;
  const name = input.name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
  if (!name) return null;
  const color = input.color && isColor(input.color)
    ? input.color
    : FOLDER_COLORS[existing.length % FOLDER_COLORS.length];
  const icon = input.icon === "exchange" || input.icon === "emoji" ? input.icon : "auto";
  const glyph = icon === "exchange" && !isPriceProvider(input.glyph ?? "")
    ? ""
    : icon === "auto"
      ? ""
      : (input.glyph ?? "").slice(0, 8);
  return {
    id: nextFolderId(name, existing.map((folder) => folder.id)),
    name,
    color,
    icon: icon === "exchange" && !glyph ? "auto" : icon,
    glyph,
    collapsed: false,
    ...(Number.isInteger(input.parentAssetId) && Number(input.parentAssetId) > 0
      ? { parentAssetId: Number(input.parentAssetId) }
      : {}),
  };
}

/** Renames / recolours / re-icons a folder; an empty name keeps the old one. */
export function updateFolder(
  folders: readonly HoldingFolder[],
  id: string,
  patch: Partial<Pick<HoldingFolder, "name" | "color" | "icon" | "glyph" | "collapsed">>,
): HoldingFolder[] {
  return folders.map((folder) => {
    if (folder.id !== id) return { ...folder };
    const name = patch.name === undefined ? folder.name : patch.name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
    const icon = patch.icon ?? folder.icon;
    const glyph = (patch.glyph ?? folder.glyph).slice(0, 8);
    return {
      ...folder,
      name: name || folder.name,
      color: patch.color && isColor(patch.color) ? patch.color : folder.color,
      icon: icon === "exchange" && !isPriceProvider(glyph) ? "auto" : icon,
      glyph: icon === "auto" ? "" : glyph,
      collapsed: patch.collapsed ?? folder.collapsed,
    };
  });
}

/**
 * Removes a folder. Holdings filed into it are *not* deleted — they drop back
 * into the plain list, which is why this returns the cleaned-up assignment map
 * too.
 */
export function removeFolder(
  folders: readonly HoldingFolder[],
  assignments: FolderAssignments,
  id: string,
): { folders: HoldingFolder[]; assignments: FolderAssignments } {
  const nextAssignments: FolderAssignments = {};
  for (const [assetId, folderId] of Object.entries(assignments)) {
    if (folderId === id) continue;
    nextAssignments[Number(assetId)] = folderId;
  }
  return { folders: folders.filter((folder) => folder.id !== id), assignments: nextAssignments };
}

/**
 * The folder a wallet import should be filed into: the existing folder with that
 * name (compared case-insensitively, so importing the same wallet twice does not
 * create "0x1234…abcd" twice), or a fresh one appended to the list.
 *
 * `folder` is `null` when the name is blank or there is no room for another
 * folder (`MAX_FOLDERS`), in which case the caller imports the holdings without
 * a folder rather than failing the whole import.
 */
export function folderForImport(
  folders: readonly HoldingFolder[],
  name: string,
): { folders: HoldingFolder[]; folder: HoldingFolder | null } {
  const wanted = name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
  const list = folders.map((folder) => ({ ...folder }));
  if (!wanted) return { folders: list, folder: null };

  const existing = list.find((folder) => folder.name.toLowerCase() === wanted.toLowerCase());
  if (existing) return { folders: list, folder: existing };

  const folder = makeFolder({ name: wanted }, list);
  if (!folder) return { folders: list, folder: null };
  return { folders: [...list, folder], folder };
}

/** Files one holding into a folder (`null` = no folder). */
export function assignHolding(
  assignments: FolderAssignments,
  assetId: number,
  folderId: string | null,
): FolderAssignments {
  const next = { ...assignments };
  if (!folderId) {
    delete next[assetId];
    return next;
  }
  next[assetId] = folderId;
  return next;
}

/** Moves one folder up (-1) or down (+1); clamped at both ends. */
export function moveFolderBy(
  folders: readonly HoldingFolder[],
  id: string,
  delta: number,
): HoldingFolder[] {
  const from = folders.findIndex((folder) => folder.id === id);
  if (from < 0) return [...folders];
  const to = Math.max(0, Math.min(folders.length - 1, from + delta));
  if (to === from) return [...folders];
  const next = [...folders];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Moves `id` so it lands before or after `overId` (drag-and-drop). */
export function moveFolderTo(
  folders: readonly HoldingFolder[],
  id: string,
  overId: string,
  after: boolean,
): HoldingFolder[] {
  const from = folders.findIndex((folder) => folder.id === id);
  const overIndex = folders.findIndex((folder) => folder.id === overId);
  if (from < 0 || overIndex < 0 || from === overIndex) return [...folders];
  const next = [...folders];
  const [moved] = next.splice(from, 1);
  const target = Math.max(0, Math.min(next.length, overIndex + (after ? 1 : 0)));
  next.splice(target, 0, moved);
  return next;
}

export type FolderGroup<T> = {
  folder: HoldingFolder;
  rows: T[];
  /** Sum of the group's row values. */
  totalValue: number;
};

/**
 * Splits rows into folder groups, in folder order. Rows keep the order they
 * arrive in inside their group, and a group with no rows is left out so an empty
 * folder does not take up a heading.
 *
 * Only real folders are returned: a holding that is in no folder is not a group
 * — there is no "Unfiled" bucket. Those rows are handed back separately as
 * `ungrouped` so the table can list them plainly above the folders.
 */
export function splitByFolder<T extends { id: number; value: number }>(
  rows: readonly T[],
  folders: readonly HoldingFolder[],
  assignments: FolderAssignments,
): { ungrouped: T[]; groups: FolderGroup<T>[] } {
  const byFolder = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const row of rows) {
    const folderId = assignments[row.id];
    if (!folderId || !folders.some((folder) => folder.id === folderId)) {
      ungrouped.push(row);
      continue;
    }
    const list = byFolder.get(folderId) ?? [];
    list.push(row);
    byFolder.set(folderId, list);
  }

  const groups: FolderGroup<T>[] = [];
  for (const folder of folders) {
    const list = byFolder.get(folder.id);
    if (!list || list.length === 0) continue;
    groups.push({
      folder,
      rows: list,
      totalValue: list.reduce((sum, row) => sum + row.value, 0),
    });
  }
  return { ungrouped, groups };
}

/** Just the folder groups — see `splitByFolder` for the rows in no folder. */
export function groupByFolder<T extends { id: number; value: number }>(
  rows: readonly T[],
  folders: readonly HoldingFolder[],
  assignments: FolderAssignments,
): FolderGroup<T>[] {
  return splitByFolder(rows, folders, assignments).groups;
}

/** Every holding filed into `folderId`, for the folder filter chips. */
export function countInFolder(assignments: FolderAssignments, folderId: string): number {
  return Object.values(assignments).filter((id) => id === folderId).length;
}

/**
 * Which folder the table is narrowed to. `all` is everything; there is
 * deliberately no "unfiled" option — holdings that are in no folder are part of
 * `all` and are listed above the folders.
 */
export type FolderFilter = "all" | `folder:${string}`;

export function folderFilterFor(id: string): FolderFilter {
  return `folder:${id}`;
}

/** True when a holding belongs to the selected folder filter. */
export function matchesFolderFilter(
  folderFilter: FolderFilter,
  assetId: number,
  assignments: FolderAssignments,
  folderIds: readonly string[],
): boolean {
  if (folderFilter === "all") return true;
  const folderId = assignments[assetId];
  if (folderId === undefined || !folderIds.includes(folderId)) return false;
  return folderId === folderFilter.slice("folder:".length);
}
