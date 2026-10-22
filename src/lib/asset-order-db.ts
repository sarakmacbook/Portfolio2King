import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { mergeOrder } from "@/lib/asset-order";
import { ensureSchema } from "@/lib/portfolio";

/**
 * Persists an explicit dashboard order. Kept separate from the server action so
 * it can be exercised against a real database without a Next.js request.
 */

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
