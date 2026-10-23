"use server";

import { revalidatePath } from "next/cache";
import { dispatchAlert, getAlertSettings, saveAlertSettings, sendTestAlert } from "@/lib/alerts";
import {
  DEFAULT_PORTFOLIO_ALERT_SETTINGS,
  MAX_PORTFOLIO_NOTE_LENGTH,
  MAX_PORTFOLIO_TEMPLATE_LENGTH,
  MAX_REFRESH_MINUTES,
  MAX_THRESHOLD_PCT,
  MIN_REFRESH_MINUTES,
  MIN_THRESHOLD_PCT,
  PORTFOLIO_MESSAGE_PLACEHOLDERS,
  composePortfolioTelegramMessage,
  describePreviewDelivery,
  enabledPortfolioCadences,
  describeTestDelivery,
  isValidTimeZone,
  normaliseAlertTime,
  ordinal,
  parseAlertWindow,
  parseMonthDay,
  parseChannels,
  parseOptionalThresholdPct,
  parseRefreshMinutes,
  parseThresholdPct,
  parseWeekday,
  resolveTimeZone,
  WEEKDAY_NAMES,
  unknownPortfolioPlaceholders,
  zonedClock,
  type AlertChannel,
  type AlertSettings,
  type AlertWindow,
} from "@/lib/alert-rules";
import { autoNoteForDate } from "@/lib/auto-notes";
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
  /** Exact text Telegram receives (portfolio preview), for the page to show. */
  sample?: string;
};

function describeWindow(window: AlertWindow): string {
  return window === "month" ? "30 days" : "a day";
}

const TEST_COOLDOWN_MS = 15_000;
let lastTestAt = 0;

/**
 * Test sends are throttled so a stuck finger cannot spam a phone. The message
 * says how long is left, which is more useful than "wait a few seconds" when
 * the push test and the portfolio preview share the same cooldown.
 */
function cooldownError(): string | null {
  const remaining = TEST_COOLDOWN_MS - (Date.now() - lastTestAt);
  if (remaining <= 0) return null;
  return `Wait ${Math.ceil(remaining / 1000)} s before sending another test message.`;
}

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
    // Cadences: each one is its own schedule and its own comparison horizon.
    const dailyEnabled = formData.get("portfolioDaily") !== null;
    const weeklyEnabled = formData.get("portfolioWeekly") !== null;
    const monthlyEnabled = formData.get("portfolioMonthly") !== null;
    if (portfolioEnabled && portfolioTime && !dailyEnabled && !weeklyEnabled && !monthlyEnabled) {
      throw new Error("Pick at least one recap — daily, weekly or monthly — or turn the portfolio update off.");
    }
    const weeklyDay = parseWeekday(formData.get("portfolioWeeklyDay"));
    if (weeklyEnabled && weeklyDay === null) {
      throw new Error("Pick a day of the week for the weekly recap.");
    }
    const sendUnchanged = formData.get("portfolioSendUnchanged") !== null;
    const autoNote = formData.get("portfolioAutoNote") !== null;
    const monthlyDay = parseMonthDay(formData.get("portfolioMonthlyDay"));
    if (monthlyEnabled && monthlyDay === null) {
      throw new Error("Monthly recap day must be between 1 and 28.");
    }

    // Custom Telegram wording. Unknown {tokens} are reported as a warning (not a
    // failure) because they are sent literally — never silently dropped.
    const telegramTemplate = String(formData.get("portfolioTelegramTemplate") ?? "").replace(/\r\n/g, "\n").trim();
    if (telegramTemplate.length > MAX_PORTFOLIO_TEMPLATE_LENGTH) {
      throw new Error(`The custom Telegram message must be ${MAX_PORTFOLIO_TEMPLATE_LENGTH} characters or fewer.`);
    }
    const telegramNote = String(formData.get("portfolioTelegramNote") ?? "").replace(/\r\n/g, "\n").trim();
    if (telegramNote.length > MAX_PORTFOLIO_NOTE_LENGTH) {
      throw new Error(`The Telegram note must be ${MAX_PORTFOLIO_NOTE_LENGTH} characters or fewer.`);
    }
    const unknownTokens = [
      ...new Set([...unknownPortfolioPlaceholders(telegramTemplate), ...unknownPortfolioPlaceholders(telegramNote)]),
    ];

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
        dailyEnabled,
        weeklyEnabled,
        weeklyDay: weeklyDay ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.weeklyDay,
        monthlyEnabled,
        monthlyDay: monthlyDay ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.monthlyDay,
        thresholdPct: portfolioThreshold.value,
        sendUnchanged,
        autoNote,
        telegramTemplate,
        telegramNote,
      },
    });
    revalidatePath("/alerts");
    revalidatePath("/", "layout");

    const holdingRule = enabled
      ? `holding alerts at ±${thresholdPct}% over ${describeWindow(window)}`
      : "holding alerts off";
    const cadenceWords = [
      dailyEnabled ? "daily" : "",
      weeklyEnabled ? `weekly on ${WEEKDAY_NAMES[weeklyDay ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.weeklyDay]}` : "",
      monthlyEnabled ? `monthly on the ${ordinal(monthlyDay ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.monthlyDay)}` : "",
    ].filter(Boolean);
    const portfolioRule = portfolioEnabled && portfolioTime
      ? `portfolio recap ${cadenceWords.join(", ")} at ${portfolioTime} (${portfolioTimezone})${
          portfolioThreshold.value !== null && sendUnchanged ? ", even when unchanged" : ""
        }`
      : "portfolio update off";
    const customWord = telegramTemplate
      ? " Custom Telegram message on."
      : telegramNote
        ? " Telegram note on."
        : "";
    return {
      ok: true,
      ts: Date.now(),
      message: `Saved. ${holdingRule.charAt(0).toUpperCase()}${holdingRule.slice(1)} · ${portfolioRule}.${customWord}`,
      warning: unknownTokens.length
        ? `Saved, but ${unknownTokens.map((token) => `{${token}}`).join(", ")} ${
            unknownTokens.length === 1 ? "is not a placeholder" : "are not placeholders"
          } and will be sent literally. Use ${PORTFOLIO_MESSAGE_PLACEHOLDERS.slice(0, 4)
            .map((placeholder) => `{${placeholder.token}}`)
            .join(", ")}, …`
        : undefined,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save alert settings" };
  }
}

export async function sendTestAlertAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const requested = String(formData.get("channel") ?? "all");
  if (!["push", "telegram", "all"].includes(requested)) return { error: "Unknown alert channel" };
  const cooling = cooldownError();
  if (cooling) return { error: cooling };
  lastTestAt = Date.now();

  try {
    const result = await sendTestAlert(requested as "push" | "telegram" | "all");
    revalidatePath("/alerts");
    const channels: AlertChannel[] =
      requested === "all" ? ["push", "telegram"] : [requested as AlertChannel];
    const described = describeTestDelivery(result, channels);
    return { ...described, ts: Date.now() };
  } catch {
    return { error: "Could not send the test alert. Check the server logs." };
  }
}

/**
 * Sends today's portfolio update immediately, whatever the clock says, so the
 * scheduled message can be previewed.
 *
 * The preview reads the settings form on `/alerts` instead of the saved rows, so
 * it matches what is on screen before "Save" is pressed — which is how someone
 * tries out a time zone or a Telegram-only setup. The optional threshold is
 * ignored (a preview should always arrive) and so is the on/off switch: testing
 * before turning the schedule on is the point of the button.
 *
 * It also has to work on a fresh portfolio: when no snapshot exists for the
 * comparison window yet, the newest snapshot is used (labelled as such) so the
 * message format and delivery can still be checked.
 */
export async function sendPortfolioUpdateNowAction(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const cooling = cooldownError();
  if (cooling) return { error: cooling };
  lastTestAt = Date.now();

  try {
    const settings = await getAlertSettings();

    // The button lives inside the settings form, so the submitted fields are
    // the on-screen values. `kind` is a hidden input — unlike a submit button's
    // name/value, which React drops when the form action is a function.
    const fromSettingsForm = formData.get("kind") === "alert-settings";
    const channels = fromSettingsForm
      ? parseChannels(formData.getAll("channels"))
      : parseChannels(settings.channels);
    if (channels.length === 0) {
      return { error: "Turn on Browser push or Telegram below, then send the preview again." };
    }
    // The preview picker on the form, falling back to the first enabled cadence.
    const window =
      (fromSettingsForm ? parseAlertWindow(formData.get("portfolioPreviewWindow")) : null) ??
      enabledPortfolioCadences(settings.portfolio)[0] ??
      "day";
    // Unsaved wording from the form, so the preview shows exactly what would be
    // sent after pressing Save.
    const telegramTemplate = fromSettingsForm
      ? String(formData.get("portfolioTelegramTemplate") ?? "").trim().slice(0, MAX_PORTFOLIO_TEMPLATE_LENGTH)
      : settings.portfolio.telegramTemplate;
    const telegramNote = fromSettingsForm
      ? String(formData.get("portfolioTelegramNote") ?? "").trim().slice(0, MAX_PORTFOLIO_NOTE_LENGTH)
      : settings.portfolio.telegramNote;
    const previewSettings: AlertSettings = {
      ...settings,
      channels,
      portfolio: { ...settings.portfolio, telegramTemplate, telegramNote },
    };

    const update = await buildPortfolioUpdate(previewSettings, 0, { preview: true, window });
    if (!update) {
      return { error: "Add an asset with a value first — there is nothing to preview yet." };
    }

    const zone = resolveTimeZone(previewSettings.portfolio.timezone);
    const previewDate = zonedClock(new Date(), zone).date;
    // Unsaved auto-note toggle too, so the preview matches what Save would do.
    const autoNoteOn = fromSettingsForm
      ? formData.get("portfolioAutoNote") !== null
      : previewSettings.portfolio.autoNote;
    const telegramText = composePortfolioTelegramMessage(update, previewSettings.portfolio, {
      date: previewDate,
      time: previewSettings.portfolio.time || "18:00",
      window,
      autoNote: autoNoteOn ? autoNoteForDate(window, previewDate) : "",
    });
    const result = await dispatchAlert({
      dedupeKey: `portfolio-test:${Date.now()}`,
      kind: "portfolio_test",
      title: update.title,
      body: update.body,
      url: "/",
      telegramText,
      settings: previewSettings,
      force: true,
    });
    revalidatePath("/alerts");

    const described = describePreviewDelivery(result, channels, update.title);
    const historyNote = update.previewFallback
      ? " No earlier snapshot yet, so the scheduled update starts once one is saved."
      : "";
    return {
      ...described,
      message: described.message ? `${described.message}${historyNote}` : described.message,
      sample: telegramText,
      ts: Date.now(),
    };
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
