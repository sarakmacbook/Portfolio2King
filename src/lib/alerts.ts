import webpush from "web-push";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertEvents, appSettings, assets, pushSubscriptions } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import { getTelegramStatus, getTelegramConfig } from "@/lib/telegram-bot";
import {
  DEFAULT_ALERT_SETTINGS,
  SETTING_KEYS,
  formatAlertText,
  parseAlertSettings,
  parseChannels,
  settingsToRows,
  telegramRequest,
  type AlertChannel,
  type AlertSettings,
  type PushPayload,
} from "@/lib/alert-rules";

const TELEGRAM_TIMEOUT_MS = 10_000;
const PUSH_TTL_SECONDS = 60 * 60 * 12;

const VAPID_PUBLIC_KEY = "push.vapidPublic";
const VAPID_PRIVATE_KEY = "push.vapidPrivate";
const AUTO_NOTE_STEP_KEY = "alerts.portfolio.autoNoteStep";

export type AlertChannelResult = {
  pushSent: number;
  pushFailed: number;
  pushRemoved: number;
  telegramSent: boolean;
  telegramError?: string;
  pushError?: string;
};

export type DispatchResult = AlertChannelResult & {
  status: "sent" | "duplicate" | "disabled" | "no-channel";
};

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim());
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getAlertSettings(): Promise<AlertSettings> {
  if (!hasDatabase()) return { ...DEFAULT_ALERT_SETTINGS };
  await ensureSchema();
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(SETTING_KEYS)));
  const values: Record<string, string> = {};
  for (const row of rows) values[row.key] = row.value;
  return parseAlertSettings(values);
}

export async function saveAlertSettings(settings: AlertSettings): Promise<void> {
  await ensureSchema();
  const rows = settingsToRows(settings);
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values(rows.map((row) => ({ ...row, updatedAt })))
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
    });
}

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/**
 * Current step offset for the auto note. Incremented on every delivered
 * portfolio recap (scheduled or manual preview) so every send gets a fresh
 * line instead of repeating the same quote across sends on the same day.
 */
export async function getAutoNoteStep(): Promise<number> {
  if (!hasDatabase()) return 0;
  await ensureSchema();
  const raw = await readSetting(AUTO_NOTE_STEP_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

export async function setAutoNoteStep(step: number): Promise<number> {
  if (!hasDatabase()) return 0;
  await ensureSchema();
  const next = Number.isFinite(step) && step >= 0 ? Math.trunc(step) : 0;
  await writeSetting(AUTO_NOTE_STEP_KEY, String(next));
  return next;
}

export async function advanceAutoNoteStep(currentStep?: number): Promise<number> {
  if (!hasDatabase()) return (currentStep ?? 0) + 1;
  await ensureSchema();
  const base =
    typeof currentStep === "number" && Number.isFinite(currentStep) && currentStep >= 0
      ? Math.trunc(currentStep)
      : await getAutoNoteStep();
  const next = base + 1;
  await writeSetting(AUTO_NOTE_STEP_KEY, String(next));
  return next;
}

/**
 * Clears stored dedupe rows for scheduled portfolio recaps when the user
 * edits the alarm schedule time, so a rescheduled alarm can fire again on the
 * same day with a fresh auto-note line.
 */
export async function clearPortfolioScheduleDedupe(): Promise<void> {
  if (!hasDatabase()) return;
  await ensureSchema();
  await db.delete(alertEvents).where(eq(alertEvents.kind, "portfolio_move"));
}

// ---------------------------------------------------------------------------
// Web Push (VAPID)
// ---------------------------------------------------------------------------

export type VapidConfig = { publicKey: string; privateKey: string; source: "env" | "generated" };

/**
 * VAPID keys come from the environment when provided; otherwise a pair is
 * generated once and stored in `app_settings`, so self-hosted instances can
 * enable browser alerts without extra configuration.
 */
export async function getVapidConfig(): Promise<VapidConfig> {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate, source: "env" };
  }

  await ensureSchema();
  const [storedPublic, storedPrivate] = await Promise.all([readSetting(VAPID_PUBLIC_KEY), readSetting(VAPID_PRIVATE_KEY)]);
  if (storedPublic && storedPrivate) {
    return { publicKey: storedPublic, privateKey: storedPrivate, source: "generated" };
  }

  const keys = webpush.generateVAPIDKeys();
  await Promise.all([
    db.insert(appSettings).values({ key: VAPID_PUBLIC_KEY, value: keys.publicKey, updatedAt: new Date() }).onConflictDoNothing(),
    db.insert(appSettings).values({ key: VAPID_PRIVATE_KEY, value: keys.privateKey, updatedAt: new Date() }).onConflictDoNothing(),
  ]);
  // Re-read: a concurrent request may have written a different pair first.
  const [finalPublic, finalPrivate] = await Promise.all([readSetting(VAPID_PUBLIC_KEY), readSetting(VAPID_PRIVATE_KEY)]);
  if (!finalPublic || !finalPrivate) throw new Error("Could not initialise push keys");
  return { publicKey: finalPublic, privateKey: finalPrivate, source: "generated" };
}

function vapidSubject(): string {
  const configured = process.env.VAPID_SUBJECT?.trim();
  return configured && /^(mailto:|https:\/\/)/.test(configured) ? configured : "mailto:ledgerly@localhost";
}

/** Sends a notification to every stored subscription and prunes dead endpoints. */
export async function sendPushToSubscribers(payload: PushPayload): Promise<{
  sent: number;
  failed: number;
  removed: number;
  error?: string;
}> {
  if (!hasDatabase()) return { sent: 0, failed: 0, removed: 0, error: "No database configured" };
  await ensureSchema();
  const subscriptions = await db.select().from(pushSubscriptions);
  if (subscriptions.length === 0) return { sent: 0, failed: 0, removed: 0 };

  let vapid: VapidConfig;
  try {
    vapid = await getVapidConfig();
    webpush.setVapidDetails(vapidSubject(), vapid.publicKey, vapid.privateKey);
  } catch {
    return { sent: 0, failed: subscriptions.length, removed: 0, error: "Push keys are unavailable" };
  }

  const body = JSON.stringify(payload);
  const deadEndpoints: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: PUSH_TTL_SECONDS, urgency: "high" },
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) deadEndpoints.push(subscription.endpoint);
      }
    }),
  );

  if (deadEndpoints.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, deadEndpoints));
  }

  return { sent, failed, removed: deadEndpoints.length };
}

export async function countPushSubscriptions(): Promise<number> {
  if (!hasDatabase()) return 0;
  await ensureSchema();
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(pushSubscriptions);
  return Number(row?.count ?? 0);
}

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<void> {
  await ensureSchema();
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: (input.userAgent ?? "").slice(0, 300),
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: input.p256dh, auth: input.auth, lastSeenAt: now },
    });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await ensureSchema();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/** True when a bot is connected from the UI or configured in the environment. */
export async function telegramConfigured(): Promise<boolean> {
  return (await getTelegramStatus()).configured;
}

/** Sends a Telegram message using the stored bot (or env fallback). */
export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getTelegramConfig();
  if (!config) return { ok: false, error: "Telegram is not configured" };

  const { url, init } = telegramRequest(config, text);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 404) {
      return { ok: false, error: "Telegram rejected the bot token" };
    }
    if (response.status === 400) {
      return { ok: false, error: "Telegram rejected the chat id — start a chat with the bot first" };
    }
    if (response.status === 429) return { ok: false, error: "Telegram rate limit reached" };
    return { ok: false, error: `Telegram returned ${response.status}` };
  } catch {
    return { ok: false, error: "Telegram is unreachable" };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function sendToChannels(
  alert: { title: string; body: string; url?: string; tag?: string },
  channels: AlertChannel[],
  /** Channel-specific wording (the portfolio update's custom Telegram text). */
  telegramText?: string,
): Promise<AlertChannelResult> {
  const result: AlertChannelResult = { pushSent: 0, pushFailed: 0, pushRemoved: 0, telegramSent: false };

  if (channels.includes("push")) {
    const push = await sendPushToSubscribers({
      title: alert.title,
      body: alert.body,
      url: alert.url ?? "/",
      tag: alert.tag,
    });
    result.pushSent = push.sent;
    result.pushFailed = push.failed;
    result.pushRemoved = push.removed;
    if (push.error) result.pushError = push.error;
  }

  if (channels.includes("telegram")) {
    const telegram = await sendTelegramMessage(telegramText ?? formatAlertText(alert));
    result.telegramSent = telegram.ok;
    if (!telegram.ok && telegram.error && telegram.error !== "Telegram is not configured") {
      result.telegramError = telegram.error;
    }
  }

  return result;
}

/**
 * Delivers one alert. `dedupeKey` is unique in the database, so concurrent or
 * repeated scheduled refreshes cannot send the same alert twice.
 */
export async function dispatchAlert(input: {
  dedupeKey: string;
  kind: string;
  title: string;
  body: string;
  assetId?: number | null;
  url?: string;
  settings?: AlertSettings;
  channels?: AlertChannel[];
  /** Test sends bypass the master switch but still honour the channel list. */
  force?: boolean;
  /**
   * Text for Telegram when it differs from the standard title + body. Push keeps
   * the structured title/body, so this never changes the notification itself.
   */
  telegramText?: string;
}): Promise<DispatchResult> {
  const settings = input.settings ?? (await getAlertSettings());
  const channels = input.channels ?? parseChannels(settings.channels);

  if (!settings.enabled && !input.force) {
    return { status: "disabled", pushSent: 0, pushFailed: 0, pushRemoved: 0, telegramSent: false };
  }
  if (channels.length === 0) {
    return { status: "no-channel", pushSent: 0, pushFailed: 0, pushRemoved: 0, telegramSent: false };
  }

  await ensureSchema();
  const inserted = await db
    .insert(alertEvents)
    .values({
      dedupeKey: input.dedupeKey,
      kind: input.kind,
      assetId: input.assetId ?? null,
      title: input.title,
      body: input.body,
      channels: channels.join(","),
    })
    .onConflictDoNothing({ target: alertEvents.dedupeKey })
    .returning({ id: alertEvents.id });

  const eventId = inserted[0]?.id;
  if (!eventId) {
    return { status: "duplicate", pushSent: 0, pushFailed: 0, pushRemoved: 0, telegramSent: false };
  }

  const result = await sendToChannels(
    { title: input.title, body: input.body, url: input.url, tag: input.dedupeKey },
    channels,
    input.telegramText,
  );

  await db
    .update(alertEvents)
    .set({ pushSent: result.pushSent, pushFailed: result.pushFailed, telegramSent: result.telegramSent ? 1 : 0 })
    .where(eq(alertEvents.id, eventId));

  return { status: "sent", ...result };
}

/** Sends a manual test to the selected channels (ignores the master switch). */
export async function sendTestAlert(channel: "push" | "telegram" | "all"): Promise<DispatchResult> {
  const channels: AlertChannel[] = channel === "all" ? ["push", "telegram"] : [channel];
  const now = new Date();
  return dispatchAlert({
    dedupeKey: `test:${now.toISOString()}`,
    kind: "test",
    title: "Ledgerly test alert",
    body: "If you can read this, alerts are working. You will get a message when a holding moves beyond your threshold.",
    url: "/alerts",
    channels,
    force: true,
    settings: { ...DEFAULT_ALERT_SETTINGS, channels },
  });
}

export async function getRecentAlerts(limit = 15) {
  if (!hasDatabase()) return [];
  await ensureSchema();
  return db.select().from(alertEvents).orderBy(desc(alertEvents.createdAt)).limit(limit);
}

/**
 * When the scheduled portfolio update last went out. Used on /alerts so
 * "is my 6 pm message being sent?" is answerable without opening the logs.
 */
export async function getLastPortfolioUpdate(): Promise<Date | null> {
  if (!hasDatabase()) return null;
  await ensureSchema();
  const [row] = await db
    .select({ at: alertEvents.createdAt })
    .from(alertEvents)
    .where(eq(alertEvents.kind, "portfolio_move"))
    .orderBy(desc(alertEvents.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/** Most recent live-price update across crypto and stock holdings. */
export async function getLastPriceRefresh(): Promise<Date | null> {
  if (!hasDatabase()) return null;
  await ensureSchema();
  const [row] = await db
    .select({ at: sql<Date | null>`max(${assets.priceUpdatedAt})` })
    .from(assets)
    .where(and(inArray(assets.type, ["crypto", "stock"]), sql`${assets.symbol} <> ''`));
  if (!row?.at) return null;
  const value = row.at instanceof Date ? row.at : new Date(row.at);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * Removes alert rows older than `days`. Called occasionally by the scheduled
 * refresh so the table does not grow without bound.
 */
export async function pruneAlertEvents(days = 90): Promise<number> {
  if (!hasDatabase()) return 0;
  await ensureSchema();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(alertEvents).where(lt(alertEvents.createdAt, cutoff)).returning({ id: alertEvents.id });
  return deleted.length;
}
