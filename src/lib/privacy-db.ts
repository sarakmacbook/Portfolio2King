import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, isDatabaseConfigured } from "@/db";
import { appSettings } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import {
  PRIVACY_COOKIE_NAME,
  PRIVACY_HIDDEN_COOKIE_NAME,
  PRIVACY_SETTING_KEY,
  parsePrivacyConfig,
  verifySessionToken,
  type StoredPrivacyConfig,
} from "@/lib/privacy";

let memoryFallbackConfig: StoredPrivacyConfig | null = null;

export async function loadPrivacyConfig(): Promise<StoredPrivacyConfig | null> {
  if (!isDatabaseConfigured()) return memoryFallbackConfig;
  try {
    await ensureSchema();
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, PRIVACY_SETTING_KEY))
      .limit(1);
    return parsePrivacyConfig(row?.value ?? null);
  } catch {
    return memoryFallbackConfig;
  }
}

export async function savePrivacyConfig(config: StoredPrivacyConfig): Promise<void> {
  memoryFallbackConfig = config;
  if (!isDatabaseConfigured()) return;
  await ensureSchema();
  const value = JSON.stringify(config);
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key: PRIVACY_SETTING_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } });
}

export async function clearPrivacyConfig(): Promise<void> {
  memoryFallbackConfig = null;
  if (!isDatabaseConfigured()) return;
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, PRIVACY_SETTING_KEY));
}

export type ServerPrivacyStatus = {
  hasPin: boolean;
  locked: boolean;
  hidden: boolean;
};

export function evaluateRequestPrivacyStatus(
  config: StoredPrivacyConfig | null,
  sessionToken: string | null | undefined,
  hiddenCookie: string | null | undefined,
): ServerPrivacyStatus {
  if (!config) {
    return {
      hasPin: false,
      locked: false,
      hidden: hiddenCookie === "1",
    };
  }
  const unlocked = verifySessionToken(sessionToken, config);
  const locked = !unlocked;
  return {
    hasPin: true,
    locked,
    hidden: locked || hiddenCookie === "1",
  };
}

export async function getServerPrivacyStatus(): Promise<ServerPrivacyStatus> {
  try {
    const [config, cookieStore] = await Promise.all([loadPrivacyConfig(), cookies()]);
    const sessionToken = cookieStore.get(PRIVACY_COOKIE_NAME)?.value;
    const hiddenCookie = cookieStore.get(PRIVACY_HIDDEN_COOKIE_NAME)?.value;
    return evaluateRequestPrivacyStatus(config, sessionToken, hiddenCookie);
  } catch {
    return { hasPin: false, locked: false, hidden: false };
  }
}
