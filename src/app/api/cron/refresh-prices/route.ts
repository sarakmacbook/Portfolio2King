import { revalidatePath } from "next/cache";
import { isDatabaseConfigured } from "@/db";
import { isVercelCron, noStoreJson, verifyCronRequest } from "@/lib/cron";
import { refreshPricesWithAlerts } from "@/lib/price-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUBLIC_COOLDOWN_MS = 60_000;
let lastPublicRunAt = 0;

/**
 * GET /api/cron/refresh-prices
 *
 * Background refresh for schedulers (systemd timer, host cron, GitHub Actions,
 * or Vercel Cron). Refreshes live crypto prices, records today's snapshots, and
 * sends Web Push / Telegram alerts for moves beyond the configured threshold.
 *
 * Authenticate with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const rejected = verifyCronRequest(request);
  if (rejected) return rejected;

  if (!isDatabaseConfigured()) {
    return noStoreJson({ ok: false, skipped: "Database not configured" });
  }

  const now = Date.now();
  if (!process.env.CRON_SECRET?.trim() && !isVercelCron(request) && now - lastPublicRunAt < PUBLIC_COOLDOWN_MS) {
    return noStoreJson({ ok: true, throttled: true });
  }
  lastPublicRunAt = now;

  try {
    const summary = await refreshPricesWithAlerts({ dispatchAlerts: true });
    revalidatePath("/", "layout");
    return noStoreJson({ ok: true, ...summary });
  } catch {
    // Provider and database errors can contain connection details — never reflect them.
    return noStoreJson({ error: "Failed to refresh prices" }, { status: 500 });
  }
}
