/**
 * Reading and storing the dashboard layout payload.
 *
 * The "Arrange layout" form sends one `FormData` with every order it collected:
 * cards, stat cards, stat labels, Holdings category tabs, the holdings
 * themselves, the folders and the filing. All of it is validated here — not in
 * the server action — so it can be exercised against a real database in tests
 * (`tests/holdings-folders.test.ts`, `tests/holdings-order.test.ts`).
 *
 * Every field is optional: a form that does not carry one leaves what is stored
 * alone, which keeps older clients (and older saves) working.
 */
import {
  clearDashboardOrder,
  clearDashboardStatLabels,
  clearDashboardStatOrder,
  clearHoldingsCategoryOrder,
  clearHoldingsFolders,
  clearHoldingsOrder,
  saveDashboardOrder,
  saveDashboardStatLabels,
  saveDashboardStatOrder,
  saveHoldingFolderAssignments,
  saveHoldingsCategoryOrder,
  saveHoldingsFolders,
  saveHoldingsOrder,
} from "@/lib/dashboard-order-db";
import { isDashboardBlockKey } from "@/lib/dashboard-layout";
import {
  isDashboardStatKey,
  normaliseDashboardStatLabels,
  type DashboardStatKey,
} from "@/lib/dashboard-stats";
import {
  normaliseAssignments,
  normaliseFolders,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { isHoldingFilter } from "@/lib/holdings-filter";

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not read the ${label}. Reload the page and try again.`);
  }
}

/** The card order: every key must be a known dashboard block. */
export function parseDashboardOrder(raw: string): string[] {
  const parsed = parseJson(raw, "dashboard layout");
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("The dashboard layout is empty.");
  if (parsed.length > 32) throw new Error("Too many dashboard sections.");
  const keys = parsed.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (keys.some((key) => !isDashboardBlockKey(key))) {
    throw new Error("The dashboard layout contains an unknown section.");
  }
  return keys;
}

/** The four stat cards, in their row order. */
export function parseDashboardStatOrder(raw: string): string[] {
  const parsed = parseJson(raw, "stat card order");
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("The stat card order is empty.");
  if (parsed.length > 16) throw new Error("Too many stat cards.");
  const keys = parsed.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (keys.some((key) => !isDashboardStatKey(key))) {
    throw new Error("The stat card order contains an unknown card.");
  }
  return keys;
}

/** Custom stat headings, as a `{ cash, invested, … }` object. */
export function parseDashboardStatLabels(raw: string): Record<DashboardStatKey, string> {
  const parsed = parseJson(raw, "stat card labels");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Could not read the stat card labels.");
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isDashboardStatKey(key) || typeof value !== "string") {
      throw new Error("The stat card labels contain an unknown card.");
    }
  }
  return normaliseDashboardStatLabels(parsed);
}

/** The left-to-right order of the Holdings category tabs. */
export function parseHoldingCategoryOrder(raw: string): string[] {
  const parsed = parseJson(raw, "holdings categories");
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The holdings categories are empty.");
  }
  if (parsed.length > 16) throw new Error("Too many holdings categories.");
  const keys = parsed.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (keys.some((key) => !isHoldingFilter(key))) {
    throw new Error("The holdings categories contain an unknown category.");
  }
  return keys;
}

/**
 * The row order of the Holdings card: a JSON array of asset ids. An empty array
 * means "no custom order" and clears the saved one.
 */
export function parseHoldingOrder(raw: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not read the holdings order. Reload the page and try again.");
  }
  if (!Array.isArray(parsed)) throw new Error("Could not read the holdings order.");
  if (parsed.length > 5000) throw new Error("Too many holdings to arrange.");
  const ids = parsed.map((value) => (typeof value === "number" ? value : Number(value)));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("The holdings order contains an unknown asset.");
  }
  return ids;
}

/** The Holdings folders: a JSON array of `{ id, name, color, icon, glyph }`. */
export function parseHoldingsFolders(raw: string): unknown[] {
  const parsed = parseJson(raw || "[]", "holdings folders");
  if (!Array.isArray(parsed)) throw new Error("Could not read the holdings folders.");
  if (parsed.length > 200) throw new Error("Too many holdings folders.");
  for (const value of parsed) {
    const name =
      value && typeof value === "object"
        ? String((value as { name?: unknown }).name ?? "").trim()
        : "";
    if (!name) throw new Error("Every holdings folder needs a name.");
  }
  return parsed;
}

/** The `assetId → folderId` map, checked against the folders being saved. */
export function parseHoldingFolderAssignments(
  raw: string,
  folderIds: readonly string[],
): Record<number, string> {
  const parsed = parseJson(raw || "{}", "holdings folders");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Could not read the holdings folders.");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 5000) throw new Error("Too many holdings to file.");
  for (const [id, folderId] of entries) {
    const assetId = Number(id);
    if (!Number.isInteger(assetId) || assetId <= 0 || typeof folderId !== "string") {
      throw new Error("The holdings folders contain an unknown holding.");
    }
  }
  const normalised = normaliseAssignments(parsed, folderIds);
  if (Object.keys(normalised).length !== entries.length) {
    throw new Error("The holdings folders contain an unknown folder.");
  }
  return normalised;
}

export type DashboardLayoutPayload = {
  order: string;
  statsOrder?: string;
  statsLabels?: string;
  holdingCategories?: string;
  holdingOrder?: string;
  holdingFolders?: string;
  holdingFolderAssignments?: string;
};

export type DashboardLayoutSaveResult = {
  folders: HoldingFolder[];
};

/**
 * Validates the whole payload first, then writes it. Validation happens before
 * the first write, so a rejected folder cannot leave the layout half-saved.
 */
export async function persistDashboardLayout(
  payload: DashboardLayoutPayload,
): Promise<DashboardLayoutSaveResult> {
  const order = parseDashboardOrder(payload.order);
  const statsOrder = payload.statsOrder ? parseDashboardStatOrder(payload.statsOrder) : null;
  const statsLabels = payload.statsLabels ? parseDashboardStatLabels(payload.statsLabels) : null;
  const holdingCategories = payload.holdingCategories
    ? parseHoldingCategoryOrder(payload.holdingCategories)
    : null;
  const holdingOrder = payload.holdingOrder !== undefined ? parseHoldingOrder(payload.holdingOrder) : null;

  const foldersInput =
    payload.holdingFolders !== undefined ? parseHoldingsFolders(payload.holdingFolders) : null;
  // The ids are what the filing points at, so folder input is normalised (and
  // checked for entries that would be dropped) before anything is written.
  const folderPreview = foldersInput ? normaliseFolders(foldersInput) : null;
  if (foldersInput && folderPreview && folderPreview.length !== foldersInput.length) {
    throw new Error("The holdings folders contain an entry that could not be read.");
  }
  const assignments =
    foldersInput && payload.holdingFolderAssignments !== undefined
      ? parseHoldingFolderAssignments(
          payload.holdingFolderAssignments,
          (folderPreview ?? []).map((folder) => folder.id),
        )
      : null;

  await saveDashboardOrder(order);
  if (statsOrder) await saveDashboardStatOrder(statsOrder);
  if (statsLabels) await saveDashboardStatLabels(statsLabels);
  if (holdingCategories) await saveHoldingsCategoryOrder(holdingCategories);
  if (holdingOrder) await saveHoldingsOrder(holdingOrder);

  let folders: HoldingFolder[] = [];
  if (foldersInput) {
    folders = await saveHoldingsFolders(foldersInput);
    await saveHoldingFolderAssignments(assignments ?? {}, folders);
  }

  return { folders };
}

/** Clears every saved layout preference, including the holdings folders. */
export async function clearDashboardLayout(): Promise<void> {
  await clearDashboardOrder();
  await clearDashboardStatOrder();
  await clearDashboardStatLabels();
  await clearHoldingsCategoryOrder();
  await clearHoldingsOrder();
  await clearHoldingsFolders();
}
