import { revalidatePath } from "next/cache";
import { isDatabaseConfigured } from "@/db";
import { isVercelCron, noStoreJson, verifyCronRequest } from "@/lib/cron";
import { refreshPricesWithAlerts } from "@/lib/price-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUBLIC_COOLDOWN_MS = 60_000;
let lastUnauthenticatedRunAt = 0;

/**
 * GET /api/cron/daily-snapshot
 *
 * Daily refresh kept for existing schedulers and the Vercel Cron entry in
 * `vercel.json`. It refreshes prices, records snapshots, and sends alerts for
 * the day. Use `/api/cron/refresh-prices` for more frequent runs.
 */
export async function GET(request: Request) {
  const rejected = verifyCronRequest(request);
  if (rejected) return rejected;

  if (!isDatabaseConfigured()) {
    return noStoreJson({ ok: false, skipped: "Database not configured" });
  }

  const now = Date.now();
  if (!process.env.CRON_SECRET?.trim() && !isVercelCron(request) && now - lastUnauthenticatedRunAt < PUBLIC_COOLDOWN_MS) {
    return noStoreJson({ ok: true, throttled: true });
  }
  lastUnauthenticatedRunAt = now;

  try {
    const summary = await refreshPricesWithAlerts({ dispatchAlerts: true });
    revalidatePath("/", "layout");
    return noStoreJson({ ok: true, ...summary });
  } catch {
    return noStoreJson({ error: "Failed to capture daily snapshot" }, { status: 500 });
  }
}
