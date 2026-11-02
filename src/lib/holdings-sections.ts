/**
 * Ordering helpers for the Holdings table.
 *
 * A detailed section order contains folder ids and one `$asset:<id>` key per
 * ungrouped holding, so groups and plain assets can be interleaved precisely.
 * Older saved orders contain `$ungrouped`; that marker expands to the current
 * ungrouped assets in their existing order, which keeps old layouts compatible.
 */
import {
  UNGROUPED_SECTION_KEY,
  assetIdFromSectionKey,
  assetSectionKey,
  isAssetSectionKey,
} from "@/lib/holdings-folders";

/**
 * Returns a complete, duplicate-free detailed order. Deleted folders/assets are
 * removed, new ungrouped assets append in their current order, and new folders
 * append after them. `$ungrouped` is only an expansion marker, never returned.
 */
export function normaliseHoldingsSections(
  order: readonly string[],
  folderIds: readonly string[],
  ungroupedAssetIds: readonly number[],
): string[] {
  const assetKeys: string[] = [];
  const seenAssetIds = new Set<number>();
  for (const assetId of ungroupedAssetIds) {
    if (!Number.isSafeInteger(assetId) || assetId <= 0 || seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    assetKeys.push(assetSectionKey(assetId));
  }

  const knownAssets = new Set(assetKeys);
  const knownFolders = new Set(folderIds);
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    result.push(key);
  };

  for (const key of order) {
    if (key === UNGROUPED_SECTION_KEY) {
      for (const assetKey of assetKeys) add(assetKey);
    } else if (knownFolders.has(key) || knownAssets.has(key)) {
      add(key);
    }
  }
  for (const assetKey of assetKeys) add(assetKey);
  for (const folderId of folderIds) add(folderId);
  return result;
}

/**
 * Projects a detailed order onto the arrange strip's coarse blocks: all plain
 * assets become one Ungrouped rows pill while folder order is retained.
 */
export function collapseHoldingsSections(order: readonly string[]): string[] {
  const result: string[] = [];
  for (const key of order) {
    const block = isAssetSectionKey(key) ? UNGROUPED_SECTION_KEY : key;
    if (block === UNGROUPED_SECTION_KEY && result.includes(block)) continue;
    result.push(block);
  }
  return result;
}

/** Expands the arrange strip's Ungrouped rows pill back into its asset keys. */
export function expandHoldingsSections(
  blocks: readonly string[],
  detailedOrder: readonly string[],
): string[] {
  const assetKeys = detailedOrder.filter(isAssetSectionKey);
  return blocks.flatMap((key) => (key === UNGROUPED_SECTION_KEY ? assetKeys : [key]));
}

/**
 * Reorders only the plain-asset keys after an individual holding is arranged.
 * Folder slots stay where they are, and every existing key is retained.
 */
export function reorderHoldingsAssetSections(
  order: readonly string[],
  holdingOrder: readonly number[],
): string[] {
  const rank = new Map(holdingOrder.map((assetId, index) => [assetId, index]));
  const assetKeys = order
    .filter(isAssetSectionKey)
    .sort((a, b) => {
      const aId = assetIdFromSectionKey(a) ?? -1;
      const bId = assetIdFromSectionKey(b) ?? -1;
      return (rank.get(aId) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(bId) ?? Number.MAX_SAFE_INTEGER);
    });
  let index = 0;
  return order.map((key) => (isAssetSectionKey(key) ? assetKeys[index++] : key));
}
