import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { normaliseDashboardOrder, type DashboardBlockKey } from "@/lib/dashboard-layout";
import { normaliseDashboardStatOrder, type DashboardStatKey } from "@/lib/dashboard-stats";
import { ensureSchema } from "@/lib/portfolio";

/**
 * Persists the dashboard card layout in `app_settings`. Kept separate from the
 * server actions so it can be exercised against a real database directly.
 */

/** app_settings key holding the dashboard card order. */
export const DASHBOARD_ORDER_SETTING = "dashboard.order";

/** app_settings key holding the left-to-right order of the four stat cards. */
export const DASHBOARD_STATS_SETTING = "dashboard.statsOrder";

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
