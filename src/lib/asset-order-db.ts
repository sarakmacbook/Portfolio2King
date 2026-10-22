import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, assets } from "@/db/schema";
import { mergeOrder } from "@/lib/asset-order";
import { normaliseGroupOrder, type HoldingGroupKey } from "@/lib/holdings-groups";
import { ensureSchema } from "@/lib/portfolio";

/**
 * Persists dashboard ordering — both the per-holding position (`sort_order`) and
 * the category/section order (stored in `app_settings`). Kept separate from the
 * server actions so it can be exercised against a real database directly.
 */

/** app_settings key holding the section order, e.g. "cash,stock,crypto-volatile". */
export const GROUP_ORDER_SETTING = "holdings.groupOrder";

/** Current asset ids in the order the app displays them. */
export async function loadAssetIdsInDisplayOrder(): Promise<number[]> {
  await ensureSchema();
  const result = await db.execute<{ id: number }>(sql`
    SELECT id FROM assets
    ORDER BY sort_order ASC NULLS LAST, type ASC, name ASC
  `);
  return result.rows.map((row) => Number(row.id));
}

/**
 * Saves `submitted` as the new order. Ids unknown to the database are ignored and
 * assets missing from the submission are appended, so a stale tab cannot drop a
 * holding from the list.
 */
export async function persistAssetOrder(submitted: readonly number[]): Promise<number[]> {
  const allIds = await loadAssetIdsInDisplayOrder();
  const ordered = mergeOrder(submitted, allIds);
  if (ordered.length === 0) return [];

  // One statement: positions come from the element's ordinality. The id list is
  // passed as JSON so it travels as a single parameter.
  await db.execute(sql`
    UPDATE assets AS a
    SET sort_order = v.position
    FROM (
      SELECT elem.value::int AS id, elem.ordinality - 1 AS position
      FROM jsonb_array_elements_text(${JSON.stringify(ordered)}::jsonb) WITH ORDINALITY AS elem(value, ordinality)
    ) AS v
    WHERE a.id = v.id
  `);
  return ordered;
}

/** Clears every explicit position, restoring the default type/name ordering. */
export async function clearAssetOrder(): Promise<void> {
  await ensureSchema();
  await db.update(assets).set({ sortOrder: null });
}

/** Next position for a new asset so it appears at the end of a custom order. */
export async function nextPositionForNewAsset(): Promise<number> {
  await ensureSchema();
  const [row] = await db
    .select({ max: sql<number | null>`max(${assets.sortOrder})` })
    .from(assets);
  return Number(row?.max ?? -1) + 1;
}

/** Category/section order, falling back to the default when unset. */
export async function loadGroupOrder(): Promise<HoldingGroupKey[]> {
  await ensureSchema();
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, GROUP_ORDER_SETTING))
    .limit(1);
  return normaliseGroupOrder(row?.value);
}

/** Stores the section order; missing groups are appended in their default spot. */
export async function saveGroupOrder(order: readonly unknown[]): Promise<HoldingGroupKey[]> {
  await ensureSchema();
  const normalised = normaliseGroupOrder(order);
  const value = normalised.join(",");
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key: GROUP_ORDER_SETTING, value, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } });
  return normalised;
}

/** Removes the stored section order (Reset to default). */
export async function clearGroupOrder(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, GROUP_ORDER_SETTING));
}
