"use server";

import { revalidatePath } from "next/cache";
import { dispatchAlert, getAlertSettings, saveAlertSettings, sendTestAlert, type DispatchResult } from "@/lib/alerts";
import {
  MAX_REFRESH_MINUTES,
  MAX_THRESHOLD_PCT,
  MIN_REFRESH_MINUTES,
  MIN_THRESHOLD_PCT,
  isValidTimeZone,
  normaliseAlertTime,
  parseAlertWindow,
  parseChannels,
  parseOptionalThresholdPct,
  parseRefreshMinutes,
  parseThresholdPct,
  resolveTimeZone,
  type AlertWindow,
} from "@/lib/alert-rules";
import { buildPortfolioUpdate, refreshPricesWithAlerts } from "@/lib/price-refresh";
import {
  clearTelegramConfig,
  discoverChatId,
  getTelegramConfig,
  getTelegramStatus,
  isValidBotToken,
  normaliseChatId,
  saveTelegramConfig,
  verifyBotToken,
} from "@/lib/telegram-bot";

export type AlertActionState = {
  error?: string;
  message?: string;
  ok?: boolean;
  ts?: number;
  /** Non-fatal note, e.g. saved but Telegram could not be reached. */
  warning?: string;
};

function describeWindow(window: AlertWindow): string {
  return window === "month" ? "30 days" : "a day";
}

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
    const window = parseAlertWindow(formData.get("window") ?? "day");
    if (window === null) {
      throw new Error("Comparison window must be a day or a month.");
    }
    const channels = parseChannels(formData.getAll("channels"));
    const enabled = formData.get("enabled") === "on";

    // Portfolio update: the time is the point, the threshold is optional.
    const portfolioEnabled = formData.get("portfolioEnabled") === "on";
    const portfolioTime = normaliseAlertTime(formData.get("portfolioTime"));
    if (portfolioTime === null) {
      throw new Error("Portfolio update time must be a 24-hour time such as 18:00.");
    }
    if (portfolioEnabled && portfolioTime === "") {
      throw new Error("Pick a time for the portfolio update, or turn it off.");
    }
    const submittedTimezone = String(formData.get("portfolioTimezone") ?? "").trim();
    if (submittedTimezone && !isValidTimeZone(submittedTimezone)) {
      throw new Error("Pick a valid time zone for the portfolio update.");
    }
    // Store the zone the server will actually use, so the page and the schedule
    // can never disagree (a blank value used to mean "server zone" while the
    // form showed the device zone).
    const portfolioTimezone = resolveTimeZone(submittedTimezone);
    const portfolioThreshold = parseOptionalThresholdPct(formData.get("portfolioThresholdPct"));
    if (portfolioThreshold === null) {
      throw new Error(
        `Portfolio threshold must be blank (always send) or between ${MIN_THRESHOLD_PCT}% and ${MAX_THRESHOLD_PCT}%.`,
      );
    }
    const portfolioWindow = parseAlertWindow(formData.get("portfolioWindow") ?? "day");
    if (portfolioWindow === null) {
      throw new Error("Portfolio comparison window must be a day or a month.");
    }

    await saveAlertSettings({
      enabled,
      thresholdPct,
      window,
      channels,
      backgroundRefreshMinutes,
      portfolio: {
        enabled: portfolioEnabled,
        time: portfolioTime,
        timezone: portfolioTimezone,
        window: portfolioWindow,
        thresholdPct: portfolioThreshold.value,
      },
    });
    revalidatePath("/alerts");
    revalidatePath("/", "layout");

    const holdingRule = enabled
      ? `holding alerts at ±${thresholdPct}% over ${describeWindow(window)}`
      : "holding alerts off";
    const portfolioRule = portfolioEnabled && portfolioTime
      ? `portfolio update at ${portfolioTime} (${portfolioTimezone})`
      : "portfolio update off";
    return {
      ok: true,
      ts: Date.now(),
      message: `Saved. ${holdingRule.charAt(0).toUpperCase()}${holdingRule.slice(1)} · ${portfolioRule}.`,
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
 * Sends today's portfolio update immediately, whatever the clock says, so the
 * scheduled message can be previewed. The optional threshold is ignored here —
 * a preview should always arrive.
 */
export async function sendPortfolioUpdateNowAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  // Submitted from the settings form through `formAction`, hence the flag.
  if (formData.get("portfolioTest") !== "1") return { error: "Unknown form" };
  if (Date.now() - lastTestAt < TEST_COOLDOWN_MS) {
    return { error: "Wait a few seconds before sending another message." };
  }
  lastTestAt = Date.now();

  try {
    const settings = await getAlertSettings();
    if (parseChannels(settings.channels).length === 0) {
      return { error: "Turn on a delivery channel below first." };
    }
    const update = await buildPortfolioUpdate(settings);
    if (!update) {
      return {
        error:
          "Not enough history yet. A portfolio snapshot is saved with every refresh, so try again after the next one.",
      };
    }

    const result = await dispatchAlert({
      dedupeKey: `portfolio-test:${Date.now()}`,
      kind: "portfolio_test",
      title: update.title,
      body: update.body,
      url: "/",
      settings,
      force: true,
    });
    revalidatePath("/alerts");
    return { ...describeTest(result, "all"), ts: Date.now() };
  } catch {
    return { error: "Could not send the portfolio update. Check the server logs." };
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
    const refreshed = summary.refreshedCrypto + summary.refreshedStocks;
    if (refreshed > 0) revalidatePath("/", "layout");
    return { refreshed, skipped: summary.skipped };
  } catch {
    return { refreshed: 0, skipped: "error" };
  }
}

/**
 * Connects (or updates) a Telegram bot from the Alerts page.
 *
 * - The token is verified with `getMe`, so a typo never gets stored silently.
 * - The chat id can be pasted, or left blank: the most recent chat that
 *   messaged the bot is used, which removes the @userinfobot step.
 * - If Telegram is unreachable from the server the credentials are still stored
 *   (with a warning) so a temporary network problem does not block setup.
 */
export async function connectTelegramAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  let message: string;
  let warning: string | undefined;

  try {
    if (formData.get("kind") !== "telegram-bot") throw new Error("Unknown form");

    const submittedToken = String(formData.get("token") ?? "").trim();
    const submittedChat = String(formData.get("chatId") ?? "").trim();
    const current = await getTelegramConfig();
    const token = submittedToken || current?.token || "";

    if (!token) throw new Error("Paste the bot token from @BotFather.");
    if (!isValidBotToken(token)) {
      throw new Error("That does not look like a bot token. It should look like 123456789:AA… — copy it from @BotFather.");
    }

    let chatId = submittedChat ? normaliseChatId(submittedChat) : null;
    if (submittedChat && !chatId) {
      throw new Error("Chat id must be a number such as 123456789, a group id like -1001234567890, or @channelname.");
    }

    const check = await verifyBotToken(token);
    if (!check.ok && check.rejected) throw new Error(check.error);

    let chatTitle = "";
    if (!check.ok) {
      // Network/API hiccup: keep the credentials, let the test message confirm later.
      if (!chatId) {
        throw new Error(`${check.error} Paste the chat id instead, or try again once the server can reach Telegram.`);
      }
      warning = `${check.error} Saved anyway — send a test message to confirm.`;
    } else if (!chatId) {
      const found = await discoverChatId(token);
      if ("error" in found) throw new Error(found.error);
      chatId = found.chatId;
      chatTitle = found.title;
    }

    if (!chatId) throw new Error("Could not work out which chat to post to. Paste the chat id.");
    await saveTelegramConfig({
      token,
      chatId,
      botUsername: check.ok ? check.username : undefined,
    });

    message = check.ok
      ? `Connected to ${check.username ? `@${check.username}` : "your bot"} · chat ${chatId}${chatTitle ? ` (${chatTitle})` : ""}. Send a test message to confirm.`
      : `Bot saved for chat ${chatId}.`;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not connect the Telegram bot" };
  }

  // Runs only after the write succeeded, so a rendering hiccup cannot turn a
  // saved bot into an error message.
  revalidatePath("/alerts");
  return { ok: true, ts: Date.now(), warning, message };
}

/** Removes the stored bot (environment credentials, if any, become active again). */
export async function disconnectTelegramAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  let message: string;
  try {
    if (formData.get("kind") !== "telegram-bot") throw new Error("Unknown form");
    await clearTelegramConfig();
    const remaining = await getTelegramStatus();
    message = remaining.configured
      ? "Bot removed. Alerts now use the environment variables (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)."
      : "Telegram bot disconnected.";
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not disconnect the bot" };
  }
  revalidatePath("/alerts");
  return { ok: true, ts: Date.now(), message };
}
