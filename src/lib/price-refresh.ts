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
  describePortfolioMove,
  composePortfolioTelegramMessage,
  describePreviewBaseline,
  detectPriceMoves,
  formatPortfolioMove,
  formatPriceMove,
  formatRefreshFailure,
  duePortfolioRuns,
  portfolioAlertKey,
  portfolioMovePassesThreshold,
  priceAlertKey,
  refreshFailureKey,
  type AlertSettings,
  type AlertWindow,
  type PortfolioAlertSettings,
  type PortfolioMove,
  type PortfolioRun,
  type PriceBaseline,
} from "@/lib/alert-rules";
import {
  computeTotals,
  ensureSchema,
  runDailyPriceSnapshot,
  today,
  type DailySnapshotRunResult,
} from "@/lib/portfolio";

/** Why the scheduled portfolio update did or did not go out this run. */
export type PortfolioUpdateStatus =
  | "sent"
  | "duplicate"
  | "no-channel"
  | "below-threshold"
  | "no-baseline"
  | "not-due"
  | "disabled"
  | "error";

export type PortfolioUpdateSummary = {
  status: PortfolioUpdateStatus;
  changeMoney?: number;
  changePct?: number;
  /** Which recap this is: day = daily, week = weekly, month = monthly. */
  cadence?: AlertWindow;
};

export type PortfolioUpdatesSummary = {
  /** One entry per enabled cadence that was due on this run. */
  runs: PortfolioUpdateSummary[];
};

export type RefreshSummary = DailySnapshotRunResult & {
  priceMoves: number;
  alertsSent: number;
  alertsSkipped: number;
  alertErrors: string[];
  portfolio?: PortfolioUpdatesSummary;
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
  onlyStale?: boolean;
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

/**
 * The portfolio total the scheduled update compares against: the latest daily
 * snapshot on or before the window cutoff (yesterday for "day", 30 days back
 * for "month"). Without any history the total from before this refresh is used
 * and labelled as such, so a brand-new portfolio never claims a daily move.
 */
async function loadPortfolioBaseline(
  window: AlertWindow,
  fallbackTotal: number,
): Promise<{ value: number; label: string } | null> {
  const todayIso = today();
  const cutoff = baselineCutoffDate(window, todayIso);
  const result = await db.execute<{ total_value: number; date: string }>(sql`
    SELECT total_value, date::text AS date
    FROM snapshots
    WHERE total_value > 0 AND date <= ${cutoff}::date
    ORDER BY date DESC
    LIMIT 1
  `);
  const usable = (candidate: { total_value: number } | undefined) => {
    const value = Number(candidate?.total_value);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const row = result.rows[0];
  const value = usable(row);
  if (row && value !== null) {
    return { value, label: describeBaseline(window, daysBetweenIso(row.date, todayIso)) };
  }

  // A month window with less than 30 days of history: use the oldest snapshot and
  // say how old it is, mirroring the per-asset rule.
  if (window !== "day") {
    const oldest = await db.execute<{ total_value: number; date: string }>(sql`
      SELECT total_value, date::text AS date
      FROM snapshots
      WHERE total_value > 0 AND date < ${todayIso}::date
      ORDER BY date ASC
      LIMIT 1
    `);
    const first = oldest.rows[0];
    const firstValue = usable(first);
    if (first && firstValue !== null) {
      return {
        value: firstValue,
        label: describeBaseline(window, daysBetweenIso(first.date, todayIso), true),
      };
    }
  }

  return fallbackTotal > 0 ? { value: fallbackTotal, label: "the last refresh" } : null;
}

export type PortfolioUpdate = {
  move: PortfolioMove;
  title: string;
  body: string;
  /**
   * True when the comparison fell back to the newest snapshot (or the current
   * total) because nothing exists on or before the cutoff. Preview only — the
   * scheduled send never invents a baseline.
   */
  previewFallback?: boolean;
};

export type BuildPortfolioUpdateOptions = {
  /**
   * Preview mode for the "send it now" button: always produce a message, even
   * on a portfolio younger than one snapshot, so delivery can be checked.
   */
  preview?: boolean;
  /**
   * Comparison window: `day` (yesterday), `week` (7 days back) or `month`
   * (~30 days back). Defaults to the daily window.
   */
  window?: AlertWindow;
};

/**
 * The newest snapshot of any date, used only by previews. A brand-new ledger has
 * today's snapshot (written on read) but nothing older, and a preview that says
 * "not enough history" looks broken when the portfolio already has a value.
 */
async function loadLatestSnapshotBaseline(
  current: number,
  window: AlertWindow,
): Promise<{ value: number; label: string } | null> {
  const todayIso = today();
  const result = await db.execute<{ total_value: number; date: string }>(sql`
    SELECT total_value, date::text AS date
    FROM snapshots
    WHERE total_value > 0
    ORDER BY date DESC
    LIMIT 1
  `);
  const row = result.rows[0];
  const value = Number(row?.total_value);
  if (row && Number.isFinite(value) && value > 0) {
    return { value, label: describePreviewBaseline(row.date, todayIso, window) };
  }
  // No snapshot at all: compare the total with itself, labelled as the fallback
  // the scheduled send would use.
  return current > 0 ? { value: current, label: describePreviewBaseline(null, todayIso, window) } : null;
}

/**
 * Current whole-portfolio change in money and percent. Used by the scheduled
 * send and by the "send it now" button on /alerts.
 */
export async function buildPortfolioUpdate(
  settings: AlertSettings,
  fallbackTotal = 0,
  options: BuildPortfolioUpdateOptions = {},
): Promise<PortfolioUpdate | null> {
  const list = await loadAssets();
  const current = computeTotals(list).totalValue;
  const window = options.window ?? "day";
  let baseline = await loadPortfolioBaseline(window, fallbackTotal);
  let previewFallback = false;
  if (!baseline && options.preview) {
    baseline = await loadLatestSnapshotBaseline(current, window);
    previewFallback = baseline !== null;
  }
  if (!baseline) return null;
  const move = describePortfolioMove(baseline.value, current, baseline.label);
  if (!move) return null;
  return { move, ...formatPortfolioMove(move), previewFallback };
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
        totalStocks: 0,
        attemptedStocks: 0,
        refreshedStocks: 0,
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
      totalStocks: 0,
      attemptedStocks: 0,
      refreshedStocks: 0,
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
    onlyStale: options.onlyStale ?? false,
    staleAfterMs: options.staleAfterMinutes ? options.staleAfterMinutes * 60_000 : undefined,
  });

  const summary: RefreshSummary = {
    ...run,
    priceMoves: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    alertErrors: [],
  };

  if (options.dispatchAlerts === false) {
    if (!settings.enabled) summary.skipped = "disabled";
    return summary;
  }

  const errors = new Set<string>();
  const after = await loadAssets();

  // 1. Threshold alerts for individual price moves over the configured window.
  //    The master switch governs these per-holding alerts only; the scheduled
  //    portfolio update below has its own switch.
  if (settings.enabled) {
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
    const attemptedPrices = run.attemptedCrypto + run.attemptedStocks;
    const refreshedPrices = run.refreshedCrypto + run.refreshedStocks;
    if (attemptedPrices > 0 && refreshedPrices === 0) {
      const failure = formatRefreshFailure(summary.date, attemptedPrices);
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
  } else {
    summary.skipped = "disabled";
  }

  // 3. The scheduled whole-portfolio update, in money and percent. The
  //    threshold is optional: without one it goes out at the chosen time every
  //    day, which is the point of the feature.
  try {
    summary.portfolio = await dispatchPortfolioUpdate({
      settings,
      beforeTotal: computeTotals(before).totalValue,
      afterTotal: computeTotals(after).totalValue,
      errors,
    });
  } catch {
    // A portfolio-update problem must not fail the price refresh (and the cron
    // response) that already succeeded.
    summary.portfolio = { runs: [{ status: "error" }] };
    errors.add("Portfolio update could not be sent");
  }
  summary.alertsSent += summary.portfolio.runs.filter((run) => run.status === "sent").length;

  // 4. Housekeeping: keep the alert log bounded.
  await pruneAlertEvents(90).catch(() => 0);

  summary.alertErrors = [...errors];
  return summary;
}

/**
 * Sends every recap that is due on this run — the daily, weekly and monthly
 * cadences are independent schedules that share one time of day. Each one
 * dedupes per period, so a second refresh the same day sends nothing and a
 * weekly recap landing on the same day as the daily one still goes out.
 */
async function dispatchPortfolioUpdate(input: {
  settings: AlertSettings;
  beforeTotal: number;
  afterTotal: number;
  errors: Set<string>;
  now?: Date;
}): Promise<PortfolioUpdatesSummary> {
  const { settings, beforeTotal, afterTotal, errors } = input;
  const portfolio = settings.portfolio;
  const now = input.now ?? new Date();

  if (!portfolio.enabled || !portfolio.time) return { runs: [{ status: "disabled" }] };

  const runs = duePortfolioRuns(now, portfolio, portfolio.timezone);
  if (runs.length === 0) return { runs: [{ status: "not-due" }] };

  const results: PortfolioUpdateSummary[] = [];
  for (const run of runs) {
    results.push(
      await dispatchPortfolioRun({
        run,
        portfolio,
        settings,
        beforeTotal,
        afterTotal,
        errors,
      }),
    );
  }
  return { runs: results };
}

async function dispatchPortfolioRun(input: {
  run: PortfolioRun;
  portfolio: PortfolioAlertSettings;
  settings: AlertSettings;
  beforeTotal: number;
  afterTotal: number;
  errors: Set<string>;
}): Promise<PortfolioUpdateSummary> {
  const { run, portfolio, settings, beforeTotal, afterTotal, errors } = input;

  // Each cadence compares with its own horizon: day → yesterday, week → the
  // close 7 days back, month → ~30 days back.
  const baseline = await loadPortfolioBaseline(run.cadence, beforeTotal);
  const move = baseline ? describePortfolioMove(baseline.value, afterTotal, baseline.label) : null;
  if (!move) return { status: "no-baseline", cadence: run.cadence };

  const change = { changeMoney: move.changeMoney, changePct: move.changePct };
  if (!portfolioMovePassesThreshold(move, portfolio.thresholdPct, portfolio.sendUnchanged)) {
    return { status: "below-threshold", cadence: run.cadence, ...change };
  }

  const alert = formatPortfolioMove(move);
  // Telegram may be formatted by the user; push keeps the structured message.
  const telegramText = composePortfolioTelegramMessage({ ...alert, move }, portfolio, {
    date: run.date,
    time: portfolio.time,
    window: run.cadence,
  });
  const result = await dispatchAlert({
    dedupeKey: portfolioAlertKey(run),
    kind: "portfolio_move",
    title: alert.title,
    body: alert.body,
    url: "/",
    telegramText,
    settings,
    // The portfolio update has its own switch, so the per-holding master
    // switch must not silence it. Channels are still respected.
    force: true,
  });

  if (result.telegramError) errors.add(`Telegram: ${result.telegramError}`);
  if (result.pushError) errors.add(`Push: ${result.pushError}`);

  const status: PortfolioUpdateStatus =
    result.status === "sent" ? "sent" : result.status === "duplicate" ? "duplicate" : "no-channel";
  return { status, cadence: run.cadence, ...change };
}
