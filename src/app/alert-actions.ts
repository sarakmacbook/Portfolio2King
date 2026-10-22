"use server";

import { revalidatePath } from "next/cache";
import { getAlertSettings, saveAlertSettings, sendTestAlert, type DispatchResult } from "@/lib/alerts";
import {
  MAX_REFRESH_MINUTES,
  MAX_THRESHOLD_PCT,
  MIN_REFRESH_MINUTES,
  MIN_THRESHOLD_PCT,
  parseChannels,
  parseRefreshMinutes,
  parseThresholdPct,
} from "@/lib/alert-rules";
import { refreshPricesWithAlerts } from "@/lib/price-refresh";

export type AlertActionState = { error?: string; message?: string; ok?: boolean; ts?: number };

const TEST_COOLDOWN_MS = 15_000;
let lastTestAt = 0;

export async function saveAlertSettingsAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  try {
    if (formData.get("kind") !== "alert-settings") throw new Error("Unknown form");
    const thresholdPct = parseThresholdPct(formData.get("thresholdPct"));
    if (thresholdPct === null) {
      throw new Error(`Threshold must be a number between ${MIN_THRESHOLD_PCT}% and ${MAX_THRESHOLD_PCT}%.`);
    }
    const rawMinutes = formData.get("backgroundRefreshMinutes");
    const backgroundRefreshMinutes = rawMinutes === "0" ? 0 : parseRefreshMinutes(rawMinutes);
    if (backgroundRefreshMinutes === null) {
      throw new Error(`Background refresh must be off (0) or between ${MIN_REFRESH_MINUTES} and ${MAX_REFRESH_MINUTES} minutes.`);
    }
    const channels = parseChannels(formData.getAll("channels"));
    const enabled = formData.get("enabled") === "on";

    await saveAlertSettings({ enabled, thresholdPct, channels, backgroundRefreshMinutes });
    revalidatePath("/alerts");
    revalidatePath("/", "layout");
    return {
      ok: true,
      ts: Date.now(),
      message: enabled
        ? `Saved. Alerts fire when a holding moves ±${thresholdPct}%.`
        : "Saved. Automatic alerts are turned off.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save alert settings" };
  }
}

function describeTest(result: DispatchResult, channel: string): { ok: boolean; message?: string; error?: string } {
  const notes: string[] = [];
  if (channel === "push" || channel === "all") {
    notes.push(result.pushSent > 0 ? `${result.pushSent} browser${result.pushSent === 1 ? "" : "s"} notified` : "no browser subscribed");
  }
  if (channel === "telegram" || channel === "all") {
    notes.push(result.telegramSent ? "Telegram sent" : "Telegram not sent");
  }
  const details = [result.telegramError, result.pushError].filter(Boolean).join(" · ");
  if (result.pushSent === 0 && !result.telegramSent) {
    return { ok: false, error: `Nothing was delivered — ${notes.join(", ")}.${details ? ` ${details}` : ""}` };
  }
  return { ok: true, message: `Test alert: ${notes.join(", ")}.${details ? ` ${details}` : ""}` };
}

export async function sendTestAlertAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const requested = String(formData.get("channel") ?? "all");
  if (!["push", "telegram", "all"].includes(requested)) return { error: "Unknown alert channel" };
  if (Date.now() - lastTestAt < TEST_COOLDOWN_MS) {
    return { error: "Wait a few seconds before sending another test." };
  }
  lastTestAt = Date.now();

  try {
    const result = await sendTestAlert(requested as "push" | "telegram" | "all");
    revalidatePath("/alerts");
    const described = describeTest(result, requested);
    return { ...described, ts: Date.now() };
  } catch {
    return { error: "Could not send the test alert. Check the server logs." };
  }
}

/**
 * Called by the in-page background timer. The server decides whether anything is
 * due, so many open tabs cannot multiply provider requests or alerts.
 */
export async function backgroundRefreshPrices(): Promise<{ refreshed: number; skipped?: string }> {
  try {
    const settings = await getAlertSettings();
    if (!settings.backgroundRefreshMinutes) return { refreshed: 0, skipped: "disabled" };
    const summary = await refreshPricesWithAlerts({
      staleAfterMinutes: settings.backgroundRefreshMinutes,
      gateMinutes: settings.backgroundRefreshMinutes,
      dispatchAlerts: true,
    });
    if (summary.refreshedCrypto > 0) revalidatePath("/", "layout");
    return { refreshed: summary.refreshedCrypto, skipped: summary.skipped };
  } catch {
    return { refreshed: 0, skipped: "error" };
  }
}
