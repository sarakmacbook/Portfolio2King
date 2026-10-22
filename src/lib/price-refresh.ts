import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import {
  dispatchAlert,
  getAlertSettings,
  getLastPriceRefresh,
  pruneAlertEvents,
} from "@/lib/alerts";
import {
  baselineCutoffDate,
  daysBetweenIso,
  describeBaseline,
  detectPriceMoves,
  formatPriceMove,
  formatRefreshFailure,
  priceAlertKey,
  refreshFailureKey,
  type AlertWindow,
  type PriceBaseline,
} from "@/lib/alert-rules";
import { ensureSchema, runDailyPriceSnapshot, today, type DailySnapshotRunResult } from "@/lib/portfolio";

export type RefreshSummary = DailySnapshotRunResult & {
  priceMoves: number;
  alertsSent: number;
  alertsSkipped: number;
  alertErrors: string[];
  skipped?: "recently-refreshed" | "disabled" | "no-assets";
};

export type RefreshOptions = {
  /** Only refresh assets whose price is older than this many minutes. */
  staleAfterMinutes?: number;
  /** Skip the whole run when the newest price is newer than this many minutes. */
  gateMinutes?: number;
  /** Evaluate thresholds and deliver alerts (scheduled/background runs). */
  dispatchAlerts?: boolean;
  /** Restrict to assets not yet priced today (legacy daily behaviour). */
  onlyStaleCrypto?: boolean;
};

type SnapshotRow = { asset_id: number; price: number; date: string };

/** Latest snapshot per asset on or before an ISO date. */
async function latestSnapshotOnOrBefore(cutoff: string): Promise<SnapshotRow[]> {
  const result = await db.execute<SnapshotRow>(sql`
    SELECT DISTINCT ON (asset_id) asset_id, price, date::text AS date
    FROM price_snapshots
    WHERE price > 0 AND date <= ${cutoff}::date
    ORDER BY asset_id, date DESC
  `);
  return result.rows;
}

/** Oldest snapshot per asset before today — used when the window is not covered. */
async function oldestSnapshotBefore(todayIso: string): Promise<SnapshotRow[]> {
  const result = await db.execute<SnapshotRow>(sql`
    SELECT DISTINCT ON (asset_id) asset_id, price, date::text AS date
    FROM price_snapshots
    WHERE price > 0 AND date < ${todayIso}::date
    ORDER BY asset_id, date ASC
  `);
  return result.rows;
}

/**
 * Baselines for alert comparisons, based on the configured window:
 *
 * - **day** — the latest close before today ("yesterday's close"), falling back
 *   to the price at the previous refresh for holdings without history.
 * - **month** — the latest close at least 30 days back. With less history the
 *   oldest recorded price is used and the message says so, so a three-day-old
 *   portfolio never claims a 30-day move.
 */
async function loadBaselines(
  previousPrices: Map<number, number>,
  window: AlertWindow,
): Promise<Map<number, PriceBaseline>> {
  const todayIso = today();
  const baselines = new Map<number, PriceBaseline>();

  const cutoff = baselineCutoffDate(window, todayIso);
  for (const row of await latestSnapshotOnOrBefore(cutoff)) {
    const id = Number(row.asset_id);
    const gap = daysBetweenIso(row.date, todayIso);
    baselines.set(id, { price: Number(row.price), label: describeBaseline(window, gap) });
  }

  if (window === "month") {
    for (const row of await oldestSnapshotBefore(todayIso)) {
      const id = Number(row.asset_id);
      if (baselines.has(id)) continue;
      const gap = daysBetweenIso(row.date, todayIso);
      baselines.set(id, { price: Number(row.price), label: describeBaseline(window, gap, true) });
    }
  }

  for (const [id, price] of previousPrices) {
    if (!baselines.has(id) && price > 0) {
      baselines.set(id, { price, label: "the last refresh" });
    }
  }
  return baselines;
}

async function loadAssets() {
  await ensureSchema();
  return db.select().from(assets);
}

/**
 * Refreshes live crypto prices, records the daily snapshots, and (optionally)
 * dispatches threshold alerts to Web Push and Telegram.
 *
 * Used by the manual refresh, the while-you-browse background timer, and the
 * scheduled `/api/cron/refresh-prices` endpoint.
 */
export async function refreshPricesWithAlerts(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const settings = await getAlertSettings();

  if (options.gateMinutes && options.gateMinutes > 0) {
    const lastRefresh = await getLastPriceRefresh();
    if (lastRefresh && Date.now() - lastRefresh.getTime() < options.gateMinutes * 60_000) {
      return {
        date: today(),
        totalAssets: 0,
        totalCrypto: 0,
        attemptedCrypto: 0,
        refreshedCrypto: 0,
        snapshottedAssets: 0,
        priceMoves: 0,
        alertsSent: 0,
        alertsSkipped: 0,
        alertErrors: [],
        skipped: "recently-refreshed",
      };
    }
  }

  const before = await loadAssets();
  if (before.length === 0) {
    return {
      date: today(),
      totalAssets: 0,
      totalCrypto: 0,
      attemptedCrypto: 0,
      refreshedCrypto: 0,
      snapshottedAssets: 0,
      priceMoves: 0,
      alertsSent: 0,
      alertsSkipped: 0,
      alertErrors: [],
      skipped: "no-assets",
    };
  }

  const previousPrices = new Map(before.map((asset) => [asset.id, asset.currentPrice] as const));
  const run = await runDailyPriceSnapshot({
    onlyStaleCrypto: options.onlyStaleCrypto ?? false,
    staleAfterMs: options.staleAfterMinutes ? options.staleAfterMinutes * 60_000 : undefined,
  });

  const summary: RefreshSummary = {
    ...run,
    priceMoves: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    alertErrors: [],
  };

  if (!settings.enabled) {
    summary.skipped = "disabled";
    return summary;
  }

  if (options.dispatchAlerts === false) return summary;

  const errors = new Set<string>();

  // 1. Threshold alerts for price moves over the configured window.
  const after = await loadAssets();
  const baselines = await loadBaselines(previousPrices, settings.window);
  const moves = detectPriceMoves(baselines, after, settings.thresholdPct);
  summary.priceMoves = moves.length;

  for (const move of moves) {
    const alert = formatPriceMove(move);
    const result = await dispatchAlert({
      dedupeKey: priceAlertKey(move, summary.date, settings.window),
      kind: "price_move",
      assetId: move.assetId,
      title: alert.title,
      body: alert.body,
      url: `/assets/${move.assetId}`,
      settings,
    });
    if (result.status === "sent") summary.alertsSent += 1;
    else summary.alertsSkipped += 1;
    if (result.telegramError) errors.add(`Telegram: ${result.telegramError}`);
    if (result.pushError) errors.add(`Push: ${result.pushError}`);
  }

  // 2. One failure alert per day when nothing could be refreshed.
  if (run.attemptedCrypto > 0 && run.refreshedCrypto === 0) {
    const failure = formatRefreshFailure(summary.date, run.attemptedCrypto);
    const result = await dispatchAlert({
      dedupeKey: refreshFailureKey(summary.date),
      kind: "refresh_failure",
      title: failure.title,
      body: failure.body,
      url: "/prices",
      settings,
    });
    if (result.status === "sent") summary.alertsSent += 1;
    else summary.alertsSkipped += 1;
    if (result.telegramError) errors.add(`Telegram: ${result.telegramError}`);
    if (result.pushError) errors.add(`Push: ${result.pushError}`);
  }

  // 3. Housekeeping: keep the alert log bounded.
  await pruneAlertEvents(90).catch(() => 0);

  summary.alertErrors = [...errors];
  return summary;
}
