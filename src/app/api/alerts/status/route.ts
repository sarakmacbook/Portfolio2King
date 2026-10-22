import { isDatabaseConfigured } from "@/db";
import { countPushSubscriptions, getAlertSettings, getVapidConfig, telegramConfigured } from "@/lib/alerts";
import { noStoreJson } from "@/lib/cron";
import { DEFAULT_ALERT_SETTINGS } from "@/lib/alert-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/alerts/status — everything the browser needs to register for push:
 * the public VAPID key, the subscriber count, and the current settings.
 */
export async function GET() {
  if (!isDatabaseConfigured()) {
    return noStoreJson({
      configured: false,
      publicKey: null,
      subscribers: 0,
      telegramConfigured: false,
      settings: DEFAULT_ALERT_SETTINGS,
    });
  }

  try {
    const [settings, subscribers, vapid] = await Promise.all([
      getAlertSettings(),
      countPushSubscriptions(),
      getVapidConfig(),
    ]);
    return noStoreJson({
      configured: true,
      publicKey: vapid.publicKey,
      subscribers,
      telegramConfigured: telegramConfigured(),
      settings,
    });
  } catch {
    return noStoreJson(
      {
        configured: true,
        publicKey: null,
        subscribers: 0,
        telegramConfigured: false,
        settings: DEFAULT_ALERT_SETTINGS,
        error: "Alert settings are unavailable",
      },
      { status: 500 },
    );
  }
}
