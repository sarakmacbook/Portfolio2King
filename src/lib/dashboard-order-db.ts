import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, assets } from "@/db/schema";
import { normaliseDashboardOrder, type DashboardBlockKey } from "@/lib/dashboard-layout";
import { normaliseHoldingFilterOrder, type HoldingFilter } from "@/lib/holdings-filter";
import {
  assignHolding,
  normaliseAssignments,
  normaliseFolders,
  type FolderAssignments,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { parseHoldingOrderIds } from "@/lib/holdings-order";
import {
  normaliseDashboardStatLabels,
  normaliseDashboardStatOrder,
  type DashboardStatKey,
} from "@/lib/dashboard-stats";
import { ensureSchema } from "@/lib/portfolio";

/**
 * Persists the dashboard card layout in `app_settings` — the card order, the
 * stat cards inside the stat row, the category tabs inside the Holdings card
 * and the order of the holdings themselves. Kept separate from the server
 * actions so it can be exercised against a real database directly.
 */

/** app_settings key holding the dashboard card order. */
export const DASHBOARD_ORDER_SETTING = "dashboard.order";

/** app_settings key holding the left-to-right order of the four stat cards. */
export const DASHBOARD_STATS_SETTING = "dashboard.statsOrder";

/** app_settings key holding custom headings for the four stat cards. */
export const DASHBOARD_STAT_LABELS_SETTING = "dashboard.statsLabels";

/** app_settings key holding the left-to-right order of the Holdings category tabs. */
export const HOLDINGS_CATEGORIES_SETTING = "holdings.categoriesOrder";

/** app_settings key holding the order of the asset rows inside the Holdings card. */
export const HOLDINGS_ORDER_SETTING = "holdings.order";

/** app_settings key holding the Holdings folders (JSON array). */
export const HOLDINGS_FOLDERS_SETTING = "holdings.folders";

/** app_settings key holding which folder each holding is filed in (JSON map). */
export const HOLDINGS_FOLDER_ASSIGNMENTS_SETTING = "holdings.folderAssignments";

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } });
}

/** Dashboard card order, falling back to the default when unset. */
export async function loadDashboardOrder(): Promise<DashboardBlockKey[]> {
  await ensureSchema();
  return normaliseDashboardOrder(await readSetting(DASHBOARD_ORDER_SETTING));
}

/** Stores the card order; missing cards are appended in their default spot. */
export async function saveDashboardOrder(order: readonly unknown[]): Promise<DashboardBlockKey[]> {
  await ensureSchema();
  const normalised = normaliseDashboardOrder(order);
  await writeSetting(DASHBOARD_ORDER_SETTING, normalised.join(","));
  return normalised;
}

/** Removes the stored card order (Reset to default). */
export async function clearDashboardOrder(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, DASHBOARD_ORDER_SETTING));
}

/** Order of the four stat cards, falling back to cash-first when unset. */
export async function loadDashboardStatOrder(): Promise<DashboardStatKey[]> {
  await ensureSchema();
  return normaliseDashboardStatOrder(await readSetting(DASHBOARD_STATS_SETTING));
}

/** Stores the stat-card order; missing cards are appended in their default spot. */
export async function saveDashboardStatOrder(order: readonly unknown[]): Promise<DashboardStatKey[]> {
  await ensureSchema();
  const normalised = normaliseDashboardStatOrder(order);
  await writeSetting(DASHBOARD_STATS_SETTING, normalised.join(","));
  return normalised;
}

/** Removes the stored stat order (Reset to default). */
export async function clearDashboardStatOrder(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, DASHBOARD_STATS_SETTING));
}

/** Headings of the four stat cards, falling back to the defaults when unset. */
export async function loadDashboardStatLabels(): Promise<Record<DashboardStatKey, string>> {
  await ensureSchema();
  return normaliseDashboardStatLabels(await readSetting(DASHBOARD_STAT_LABELS_SETTING));
}

/** Stores custom headings for the four stat cards; blank entries fall back to defaults. */
export async function saveDashboardStatLabels(
  labels: unknown,
): Promise<Record<DashboardStatKey, string>> {
  await ensureSchema();
  const normalised = normaliseDashboardStatLabels(labels);
  await writeSetting(DASHBOARD_STAT_LABELS_SETTING, JSON.stringify(normalised));
  return normalised;
}

/** Removes custom stat headings (Reset to default). */
export async function clearDashboardStatLabels(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, DASHBOARD_STAT_LABELS_SETTING));
}

/** Order of the Holdings category tabs, falling back to "All" first when unset. */
export async function loadHoldingsCategoryOrder(): Promise<HoldingFilter[]> {
  await ensureSchema();
  return normaliseHoldingFilterOrder(await readSetting(HOLDINGS_CATEGORIES_SETTING));
}

/** Stores the category tab order; missing tabs are appended in their default spot. */
export async function saveHoldingsCategoryOrder(
  order: readonly unknown[],
): Promise<HoldingFilter[]> {
  await ensureSchema();
  const normalised = normaliseHoldingFilterOrder(order);
  await writeSetting(HOLDINGS_CATEGORIES_SETTING, normalised.join(","));
  return normalised;
}

/** Removes the stored category order (Reset to default). */
export async function clearHoldingsCategoryOrder(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, HOLDINGS_CATEGORIES_SETTING));
}

/**
 * Order of the asset rows in the Holdings card, as stored ids (empty = the
 * holdings are shown in the default order, sorted or as the database returns
 * them). Ids of deleted holdings are kept out of the way by the caller, which
 * normalises them against the holdings that still exist.
 */
export async function loadHoldingsOrder(): Promise<number[]> {
  await ensureSchema();
  return parseHoldingOrderIds(await readSetting(HOLDINGS_ORDER_SETTING));
}

/** Stores the holding order; an empty list clears it (back to the default order). */
export async function saveHoldingsOrder(order: readonly unknown[]): Promise<number[]> {
  await ensureSchema();
  const ids = parseHoldingOrderIds(order);
  if (ids.length === 0) {
    await clearHoldingsOrder();
    return [];
  }
  await writeSetting(HOLDINGS_ORDER_SETTING, ids.join(","));
  return ids;
}

/** Removes the stored holding order (Reset to default). */
export async function clearHoldingsOrder(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, HOLDINGS_ORDER_SETTING));
}

/** Folders shown above the Holdings table, in display order. */
export async function loadHoldingsFolders(): Promise<HoldingFolder[]> {
  await ensureSchema();
  return normaliseFolders(await readSetting(HOLDINGS_FOLDERS_SETTING));
}

/** Stores the folders; an empty list clears them (back to one flat table). */
export async function saveHoldingsFolders(folders: readonly unknown[]): Promise<HoldingFolder[]> {
  await ensureSchema();
  const normalised = normaliseFolders(folders);
  if (normalised.length === 0) {
    await clearHoldingsFolders();
    return [];
  }
  await writeSetting(HOLDINGS_FOLDERS_SETTING, JSON.stringify(normalised));
  return normalised;
}

/** Removes the folders and, with them, every filing (Reset to default). */
export async function clearHoldingsFolders(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, HOLDINGS_FOLDERS_SETTING));
  await db.delete(appSettings).where(eq(appSettings.key, HOLDINGS_FOLDER_ASSIGNMENTS_SETTING));
}

/** Which folder each holding is filed in, ignoring deleted folders. */
export async function loadHoldingFolderAssignments(
  folders?: readonly HoldingFolder[],
): Promise<FolderAssignments> {
  await ensureSchema();
  const list = folders ?? (await loadHoldingsFolders());
  const folderIds = list.map((folder) => folder.id);
  return normaliseAssignments(await readSetting(HOLDINGS_FOLDER_ASSIGNMENTS_SETTING), folderIds);
}

/** Stores the filing map; holdings that are in no folder are simply left out. */
export async function saveHoldingFolderAssignments(
  assignments: unknown,
  folders?: readonly HoldingFolder[],
): Promise<FolderAssignments> {
  await ensureSchema();
  const list = folders ?? (await loadHoldingsFolders());
  const folderIds = list.map((folder) => folder.id);
  const normalised = normaliseAssignments(assignments, folderIds);
  if (Object.keys(normalised).length === 0) {
    await db.delete(appSettings).where(eq(appSettings.key, HOLDINGS_FOLDER_ASSIGNMENTS_SETTING));
    return {};
  }
  await writeSetting(HOLDINGS_FOLDER_ASSIGNMENTS_SETTING, JSON.stringify(normalised));
  return normalised;
}

/**
 * Files one holding into a folder (`null` = no folder) and stores it.
 *
 * Only that one assignment is read-modify-written, so two drops in quick
 * succession cannot clobber each other, and both the holding and the folder are
 * checked first: a stale page (folder deleted in another tab) is refused instead
 * of filing a holding into a folder that no longer exists.
 */
export async function setHoldingFolder(
  assetId: number,
  folderId: string | null,
): Promise<FolderAssignments> {
  await ensureSchema();
  if (!Number.isInteger(assetId) || assetId <= 0) throw new Error("Unknown holding.");

  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) throw new Error("That holding no longer exists.");

  const folders = await loadHoldingsFolders();
  const requested = typeof folderId === "string" ? folderId.trim() : "";
  const target = requested && folders.some((folder) => folder.id === requested) ? requested : null;
  if (requested && !target) throw new Error("That folder no longer exists.");

  const current = await loadHoldingFolderAssignments(folders);
  return saveHoldingFolderAssignments(assignHolding(current, assetId, target), folders);
}
