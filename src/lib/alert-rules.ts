/**
 * Pure alert rules: settings parsing, move detection, dedupe keys, and message
 * formatting. No database or network access, so everything here is unit-tested
 * directly (see tests/alerts.test.ts).
 */

/**
 * Every way an alert can be delivered. Adding a value here means handling it in
 * `sendToChannels()` and offering it in the /alerts channel checkboxes.
 */
export const ALERT_CHANNELS = ["push", "telegram"] as const;
/** One delivery channel — "push" (Web Push) or "telegram". */
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

/** Window a price move is measured over: one day, or one month (30 days). */
export const ALERT_WINDOWS = ["day", "week", "month"] as const;
export type AlertWindow = (typeof ALERT_WINDOWS)[number];

/** How far back each window looks, in days. A month is a fixed 30 days. */
export const WINDOW_DAYS: Record<AlertWindow, number> = { day: 1, week: 7, month: 30 };


/**
 * The whole-portfolio update: one message at a chosen local time that reports
 * how much the portfolio moved in money and percent. The threshold is optional
 * — blank means "always send at this time", whatever the change.
 */
export type PortfolioAlertSettings = {
  /**
   * Own switch, independent of the per-holding threshold alerts.
   * `false` = no scheduled update at all; a manual preview still works.
   * Stored as `alerts.portfolio.enabled` ("true"/"false").
   */
  enabled: boolean;
  /**
   * Local wall-clock time the update belongs to, `HH:MM` (24 h) — never a UTC
   * instant, because the schedule is "6 pm where I live".
   * Empty string = no schedule (a blank time turns the feature off).
   * Stored as `alerts.portfolio.time`.
   */
  time: string;
  /**
   * IANA zone `time` is read in, e.g. `Asia/Phnom_Penh`. The first refresh at or
   * after this local time sends the message; saveAlertSettingsAction replaces a
   * blank value with the server's zone so the page and the schedule agree.
   * Stored as `alerts.portfolio.timezone`.
   */
  timezone: string;
  /**
   * Send a recap every day, compared with yesterday's snapshot.
   * Stored as `alerts.portfolio.daily`.
   */
  dailyEnabled: boolean;
  /**
   * Send a recap once a week, compared with the snapshot 7 days back.
   * Stored as `alerts.portfolio.weekly`.
   */
  weeklyEnabled: boolean;
  /**
   * Which day the weekly recap goes out: `0` = Sunday … `6` = Saturday.
   * Stored as `alerts.portfolio.weeklyDay`.
   */
  weeklyDay: number;
  /**
   * Send a recap once a month, compared with the snapshot ~30 days back.
   * Stored as `alerts.portfolio.monthly`.
   */
  monthlyEnabled: boolean;
  /**
   * Day of the month the monthly recap goes out, `1`–`28` so every month has
   * that day (a 31st would skip February). Stored as
   * `alerts.portfolio.monthlyDay`.
   */
  monthlyDay: number;
  /**
   * Optional filter in percent (0.5–50). `null` (blank in the form) means
   * "always send at this time", which is the common case for a daily update.
   * Stored as `alerts.portfolio.thresholdPct`, with "" for null.
   */
  thresholdPct: number | null;
  /**
   * Send the recap even when the total is unchanged (0.00 %). With a threshold
   * set, a flat day is skipped; this flag keeps the daily total coming anyway.
   * A blank threshold already sends everything, so this only matters alongside
   * one. Stored as `alerts.portfolio.sendUnchanged` ("true"/"false").
   */
  sendUnchanged: boolean;
  /**
   * Telegram-only message template, using `{total}`, `{percent}`, … tokens
   * (see PORTFOLIO_MESSAGE_PLACEHOLDERS). Blank = the standard title + body.
   * Browser push always keeps the structured title/body.
   * Stored as `alerts.portfolio.telegramTemplate`, capped at
   * MAX_PORTFOLIO_TEMPLATE_LENGTH.
   */
  telegramTemplate: string;
  /**
   * Optional line appended to the Telegram message, after the template (or after
   * the standard text when no template is set). Rarely longer than a sentence.
   * Stored as `alerts.portfolio.telegramNote`, capped at MAX_PORTFOLIO_NOTE_LENGTH.
   */
  telegramNote: string;
  /**
   * Append an auto-written line (a short quote or reminder) to every scheduled
   * recap. One line per period, picked offline from a built-in list, so each
   * send reads differently without typing anything. It follows the manual note
   * when both are set.
   * Stored as `alerts.portfolio.autoNote` ("true"/"false").
   */
  autoNote: boolean;
};

export type AlertSettings = {
  /**
   * Master switch for the automatic per-holding alerts. Manual test sends bypass
   * it (that is how a setup is verified before switching alerts on), and it does
   * not touch the scheduled portfolio update, which has its own switch.
   * Stored as `alerts.enabled`.
   */
  enabled: boolean;
  /**
   * How far a single holding must move before it alerts, in percent,
   * e.g. `5` = ±5 %. Range MIN_THRESHOLD_PCT–MAX_THRESHOLD_PCT, one decimal.
   * Stored as `alerts.thresholdPct`.
   */
  thresholdPct: number;
  /**
   * Comparison window for those per-holding alerts: `day` = yesterday's close,
   * `month` = the price ~30 days ago. Day and month rules never dedupe each
   * other, so switching the window can send a fresh alert the same day.
   * Stored as `alerts.window`.
   */
  window: AlertWindow;
  /**
   * Where alerts are delivered. An empty array is a valid state ("no channels"):
   * nothing is sent and the page says so. Closed set — see ALERT_CHANNELS.
   * Stored as a comma-separated `alerts.channels`, e.g. "push,telegram".
   */
  channels: AlertChannel[];
  /**
   * While a tab is open, prices are refreshed at most this often, in minutes.
   * `0` disables the in-page timer. Scheduled cron/systemd runs are unaffected.
   * Range MIN_REFRESH_MINUTES–MAX_REFRESH_MINUTES. Stored as
   * `refresh.intervalMinutes`.
   */
  backgroundRefreshMinutes: number;
  /**
   * The scheduled whole-portfolio summary (money + %). Independent of
   * `enabled` above. See PortfolioAlertSettings for each of its fields.
   */
  portfolio: PortfolioAlertSettings;
};

/** Smallest per-holding (and portfolio) threshold the form accepts, in percent. */
export const MIN_THRESHOLD_PCT = 0.5;
/** Largest threshold the form accepts, in percent. */
export const MAX_THRESHOLD_PCT = 50;
/** Shortest in-page background refresh interval, in minutes (below = noise). */
export const MIN_REFRESH_MINUTES = 5;
/** Longest background refresh interval, in minutes (12 hours). */
export const MAX_REFRESH_MINUTES = 720;

/**
 * Used for a database row that has never been written, and by tests. The update
 * starts switched off at 18:00 so enabling it is always a deliberate act.
 */
export const DEFAULT_PORTFOLIO_ALERT_SETTINGS: PortfolioAlertSettings = {
  enabled: false,
  time: "18:00",
  timezone: "",
  // All three cadences start ticked: the point of the feature is an automatic
  // daily, weekly and monthly recap. The master switch above still decides
  // whether anything is sent at all, and each cadence can be unticked.
  dailyEnabled: true,
  weeklyEnabled: true,
  weeklyDay: 1,
  monthlyEnabled: true,
  monthlyDay: 1,
  thresholdPct: null,
  // Opt-in: a threshold normally means "only wake me when it moved", and a
  // perfectly flat day is the quietest of all.
  sendUnchanged: false,
  // Ticked by default so every recap gets a fresh line unless unticked.
  autoNote: true,
  telegramTemplate: "",
  telegramNote: "",
};

/** Guards against pasting a wall of text into a chat app. */
export const MAX_PORTFOLIO_TEMPLATE_LENGTH = 1_000;
/** Same guard for the optional trailing note. */
export const MAX_PORTFOLIO_NOTE_LENGTH = 500;

/** Telegram's hard limit for one message, in UTF-16 code units. */
export const MAX_TELEGRAM_TEXT_LENGTH = 4_096;

/**
 * Settings for a fresh install: holding alerts on at ±5 % over a day, both
 * channels ticked, a 15-minute in-page refresh, and the scheduled portfolio
 * update off until a time is chosen.
 */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  thresholdPct: 5,
  window: "day",
  channels: ["push", "telegram"],
  backgroundRefreshMinutes: 15,
  portfolio: DEFAULT_PORTFOLIO_ALERT_SETTINGS,
};

/**
 * Keys used in the `app_settings` table (one text row each).
 *
 * They are the storage contract: renaming one strands existing installations on
 * their defaults until the row is rewritten, so treat them as append-only.
 */
export const SETTING_KEYS = {
  /** Master switch for automatic holding alerts — "true" / "false". */
  enabled: "alerts.enabled",
  /** Holding threshold in percent — e.g. "5" (one decimal kept). */
  thresholdPct: "alerts.thresholdPct",
  /** Holding comparison window — "day" or "month". */
  window: "alerts.window",
  /** Delivery channels — comma-separated, e.g. "push,telegram"; "" = none. */
  channels: "alerts.channels",
  /** In-page refresh interval in minutes — "0" (off) or 5–720. */
  backgroundRefreshMinutes: "refresh.intervalMinutes",
  /** Scheduled portfolio update switch — "true" / "false". */
  portfolioEnabled: "alerts.portfolio.enabled",
  /** Local send time — "HH:MM"; an explicitly blank row means "no schedule". */
  portfolioTime: "alerts.portfolio.time",
  /** IANA zone the time is read in — empty means the server's zone. */
  portfolioTimezone: "alerts.portfolio.timezone",
  /**
   * LEGACY: the single comparison window portfolios used before the cadence
   * schedules existed ("day" or "month"). Still read so old rows do not break,
   * never written any more — the cadences below replace it.
   */
  portfolioWindow: "alerts.portfolio.window",
  /** Daily recap switch — "true" / "false". */
  portfolioDaily: "alerts.portfolio.daily",
  /** Weekly recap switch — "true" / "false". */
  portfolioWeekly: "alerts.portfolio.weekly",
  /** Weekday of the weekly recap — "0" (Sunday) … "6" (Saturday). */
  portfolioWeeklyDay: "alerts.portfolio.weeklyDay",
  /** Monthly recap switch — "true" / "false". */
  portfolioMonthly: "alerts.portfolio.monthly",
  /** Day of the month of the monthly recap — "1" … "28". */
  portfolioMonthlyDay: "alerts.portfolio.monthlyDay",
  /** Send a recap even when the total is unchanged — "true" / "false". */
  portfolioSendUnchanged: "alerts.portfolio.sendUnchanged",
  /** Add an auto-written quote/sign-off to each recap — "true" / "false". */
  portfolioAutoNote: "alerts.portfolio.autoNote",
  /** Optional portfolio threshold in percent — "" means "always send". */
  portfolioThresholdPct: "alerts.portfolio.thresholdPct",
  /** Custom Telegram message — "" = the standard title + body. */
  portfolioTelegramTemplate: "alerts.portfolio.telegramTemplate",
  /** Extra Telegram line appended after the message — usually "". */
  portfolioTelegramNote: "alerts.portfolio.telegramNote",
} as const;

export function parseBooleanSetting(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export function parseThresholdPct(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_THRESHOLD_PCT || value > MAX_THRESHOLD_PCT) return null;
  // One decimal is enough; keeps alert keys stable.
  return Math.round(value * 10) / 10;
}

/** Accepts `day`, `month` (and common spellings); anything else is invalid. */
export function parseAlertWindow(raw: unknown): AlertWindow | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (["day", "daily", "1d", "24h", "yesterday"].includes(value)) return "day";
  if (["week", "weekly", "7d", "7 days"].includes(value)) return "week";
  if (["month", "monthly", "30d", "30 days"].includes(value)) return "month";
  return null;
}

/** Weekday `0` (Sunday) … `6` (Saturday); anything else is `null`. */
export function parseWeekday(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!/^[0-6]$/.test(value)) return null;
  return Number(value);
}

/**
 * Day of the month `1`–`28`. The 29th–31st are refused on purpose: those days do
 * not exist in every month, so a monthly recap set to the 31st would silently
 * skip February (and the 30th would skip it too).
 */
export function parseMonthDay(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!/^\d{1,2}$/.test(value)) return null;
  const day = Number(value);
  return day >= 1 && day <= 28 ? day : null;
}

/** Shifts an ISO date (`YYYY-MM-DD`) by whole days, in UTC. */
export function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (positive when `later` is after `earlier`). */
export function daysBetweenIso(earlier: string, later: string): number {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/**
 * Latest snapshot date a move is measured from: yesterday for a day window,
 * 30 days back for a month window.
 */
export function baselineCutoffDate(window: AlertWindow, today: string): string {
  return shiftIsoDate(today, -WINDOW_DAYS[window]);
}

/**
 * Wording for the baseline price an alert compares against.
 * `earliest` marks the fallback used when there is less than a full window of
 * history, so the message never claims a 30-day move from a 5-day-old price.
 */
export function describeBaseline(window: AlertWindow, gapDays: number, earliest = false): string {
  const ago = gapDays <= 1 ? "yesterday" : `${gapDays} days ago`;
  if (earliest) return `the earliest recorded price (${ago})`;
  if (window === "day") return gapDays <= 1 ? "yesterday's close" : `the close ${ago}`;
  if (window === "week") return gapDays === 7 ? "last week's close" : `the close ${ago}`;
  return `the price ${ago}`;
}

/**
 * Wording for the snapshot a *preview* falls back to when nothing exists on or
 * before the window cutoff: the newest snapshot (today's included) or, with no
 * snapshots at all, the total from the previous refresh.
 */
export function describePreviewBaseline(
  snapshotDate: string | null,
  todayIso: string,
  window: AlertWindow,
): string {
  if (!snapshotDate) return "the last refresh";
  if (snapshotDate === todayIso) return "today's snapshot";
  return describeBaseline(window, daysBetweenIso(snapshotDate, todayIso));
}

export function parseChannels(raw: unknown): AlertChannel[] {
  const parts = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map((part) => String(part).trim().toLowerCase())
    .filter(Boolean);
  const channels = ALERT_CHANNELS.filter((channel) => parts.includes(channel));
  return channels;
}

export function parseRefreshMinutes(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0;
  if (value < MIN_REFRESH_MINUTES || value > MAX_REFRESH_MINUTES) return null;
  return Math.round(value);
}

/**
 * Blank is a valid value ("no threshold, always send"); anything else must be a
 * number in range. Returns `null` only for an invalid, non-blank value.
 */
export function parseOptionalThresholdPct(raw: unknown): { value: number | null } | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { value: null };
  const value = parseThresholdPct(raw);
  return value === null ? null : { value };
}

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Normalises `18:00` / `9:05`. Blank means "no scheduled alert"; junk is `null`. */
export function normaliseAlertTime(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

/** `18:30` → 1110 minutes after local midnight. */
export function parseAlertTimeMinutes(time: string | null | undefined): number | null {
  const match = TIME_PATTERN.exec(String(time ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timeFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  timeFormatters.set(timeZone, formatter);
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    timeFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Stored zone, or the server's own zone when the setting is blank/invalid. */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  const value = String(timeZone ?? "").trim();
  if (value && isValidTimeZone(value)) return value;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Weekday names, Sunday first, matching `weeklyDay` (0–6). */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** `1` → "1st", `2` → "2nd", `11` → "11th", `22` → "22nd". */
export function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export type ZonedClock = { date: string; minutes: number };

/** Wall clock in a zone: local `YYYY-MM-DD` plus minutes after midnight. */
export function zonedClock(instant: Date, timeZone: string): ZonedClock {
  const zone = resolveTimeZone(timeZone);
  const parts = timeFormatter(zone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const { date, minutes } = zonedClock(new Date(instant), timeZone);
  const [year, month, day] = date.split("-").map(Number);
  // Wall clock read back as if it were UTC, minus the real instant = the offset.
  return Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60) - Math.floor(instant / 60_000) * 60_000;
}

/** The UTC instant at which a zone's wall clock reads `date` + `minutes`. */
export function zonedTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const zone = resolveTimeZone(timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // Two passes handle zones whose offset differs at the guess (DST edges).
  const first = guess - zoneOffsetMs(guess, zone);
  const second = guess - zoneOffsetMs(first, zone);
  return new Date(second);
}

export type PortfolioSchedule = {
  /** Local date the update belongs to (the date of the scheduled run). */
  date: string;
  /** Instant it was due. */
  at: Date;
  /** Whole minutes since it was due; 0 when the run is punctual. */
  lateMinutes: number;
};

/**
 * A run that is due today, for one cadence. `cadence` is also the comparison
 * window: the daily recap compares with yesterday, the weekly one with the
 * close 7 days back, the monthly one with ~30 days back.
 */
export type PortfolioRun = PortfolioSchedule & {
  cadence: PortfolioCadence;
  /**
   * Identifies the period the run belongs to, so the dedupe key fires once per
   * period. Daily = the local date, weekly = the local date of the chosen
   * weekday, monthly = `YYYY-MM`. Changing the weekday / day of month therefore
   * re-arms the period, which is what a deliberate schedule edit should do.
   */
  periodKey: string;
};

/** The three recap cadences; each one is also its own comparison window. */
export const PORTFOLIO_CADENCES = ["day", "week", "month"] as const;
export type PortfolioCadence = AlertWindow;

/** Local weekday (`0` Sunday … `6` Saturday) of an ISO date. */
export function isoDateWeekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Local day of the month (`1`–`31`) of an ISO date. */
export function isoDateDayOfMonth(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate();
}

/**
 * Today's scheduled run of one cadence, or `null` when today is not that
 * cadence's day (or the clock is still before the chosen time).
 *
 * The run belongs to the local day it fires on: once the clock passes the
 * chosen time, the next refresh sends *that day's* update — later the same day
 * still counts, so a scheduler that runs at 22:00 still delivers an 18:00
 * update. It never fires early, and yesterday's run is never sent today: an
 * "18:00" setting must not arrive at 00:05 just because a tab opened.
 *
 * A day with no refresh at all is skipped rather than sent stale, which is why
 * the scheduler should run at least once shortly after the chosen time; a
 * weekly or monthly slot missed for a whole day waits for its next period
 * instead of arriving late with stale numbers.
 */
export function portfolioScheduleFor(
  now: Date,
  time: string,
  timeZone: string,
  cadence: PortfolioCadence = "day",
  settings?: Pick<PortfolioAlertSettings, "weeklyDay" | "monthlyDay">,
): PortfolioRun | null {
  const minutes = parseAlertTimeMinutes(time);
  if (minutes === null) return null;
  const zone = resolveTimeZone(timeZone);
  const clock = zonedClock(now, zone);
  if (clock.minutes < minutes) return null;
  if (!cadenceFallsOnDate(cadence, clock.date, settings)) return null;
  return {
    cadence,
    date: clock.date,
    at: zonedTimeToUtc(clock.date, minutes, zone),
    lateMinutes: clock.minutes - minutes,
    periodKey: cadence === "month" ? clock.date.slice(0, 7) : clock.date,
  };
}

/** Whether a cadence is scheduled on this local date. */
function cadenceFallsOnDate(
  cadence: PortfolioCadence,
  date: string,
  settings?: Pick<PortfolioAlertSettings, "weeklyDay" | "monthlyDay">,
): boolean {
  if (cadence === "day") return true;
  if (cadence === "week") {
    const weekday = settings?.weeklyDay ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.weeklyDay;
    return isoDateWeekday(date) === weekday;
  }
  const monthDay = settings?.monthlyDay ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.monthlyDay;
  return isoDateDayOfMonth(date) === monthDay;
}

/** Which cadences are switched on in these settings. */
export function enabledPortfolioCadences(
  settings: Pick<PortfolioAlertSettings, "dailyEnabled" | "weeklyEnabled" | "monthlyEnabled">,
): PortfolioCadence[] {
  const cadences: PortfolioCadence[] = [];
  if (settings.dailyEnabled) cadences.push("day");
  if (settings.weeklyEnabled) cadences.push("week");
  if (settings.monthlyEnabled) cadences.push("month");
  return cadences;
}

/**
 * Every run that is due right now — one per enabled cadence that falls on
 * today and whose time has passed. Empty when the update is off, the time is
 * blank, or today is not a scheduled day.
 */
export function duePortfolioRuns(
  now: Date,
  settings: PortfolioAlertSettings,
  timeZone: string,
): PortfolioRun[] {
  if (!settings.enabled) return [];
  const time = normaliseAlertTime(settings.time);
  if (!time) return [];
  return enabledPortfolioCadences(settings).flatMap((cadence) => {
    const run = portfolioScheduleFor(now, time, timeZone, cadence, settings);
    return run ? [run] : [];
  });
}

const MAX_SCHEDULE_LOOKAHEAD_DAYS = 40;

/**
 * Next instant any enabled cadence is due (strictly after `now`), for the UI.
 * `null` when the update is off or no cadence is enabled.
 */
export function nextPortfolioAlertAt(
  now: Date,
  time: string,
  timeZone: string,
  settings?: Pick<
    PortfolioAlertSettings,
    "dailyEnabled" | "weeklyEnabled" | "weeklyDay" | "monthlyEnabled" | "monthlyDay"
  >,
): Date | null {
  const minutes = parseAlertTimeMinutes(time);
  if (minutes === null) return null;
  const zone = resolveTimeZone(timeZone);
  const clock = zonedClock(now, zone);
  const cadences = settings
    ? enabledPortfolioCadences(settings)
    : (["day"] as PortfolioCadence[]);
  if (cadences.length === 0) return null;
  for (let offset = 0; offset <= MAX_SCHEDULE_LOOKAHEAD_DAYS; offset += 1) {
    const date = shiftIsoDate(clock.date, offset);
    if (offset === 0 && clock.minutes >= minutes) continue;
    if (!cadences.some((cadence) => cadenceFallsOnDate(cadence, date, settings))) continue;
    return zonedTimeToUtc(date, minutes, zone);
  }
  return null;
}

export function parsePortfolioAlertSettings(
  values: Record<string, string | null | undefined>,
): PortfolioAlertSettings {
  const rawTime = values[SETTING_KEYS.portfolioTime];
  const parsedTime = normaliseAlertTime(rawTime);
  const threshold = values[SETTING_KEYS.portfolioThresholdPct];
  return {
    enabled: parseBooleanSetting(
      values[SETTING_KEYS.portfolioEnabled],
      DEFAULT_PORTFOLIO_ALERT_SETTINGS.enabled,
    ),
    // No stored row at all → the default time; an explicitly blank row → off.
    time: rawTime === undefined || rawTime === null
      ? DEFAULT_PORTFOLIO_ALERT_SETTINGS.time
      : (parsedTime ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.time),
    timezone: String(values[SETTING_KEYS.portfolioTimezone] ?? "").trim(),
    dailyEnabled: parseBooleanSetting(
      values[SETTING_KEYS.portfolioDaily],
      DEFAULT_PORTFOLIO_ALERT_SETTINGS.dailyEnabled,
    ),
    weeklyEnabled: parseBooleanSetting(
      values[SETTING_KEYS.portfolioWeekly],
      DEFAULT_PORTFOLIO_ALERT_SETTINGS.weeklyEnabled,
    ),
    weeklyDay: parseWeekday(values[SETTING_KEYS.portfolioWeeklyDay]) ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.weeklyDay,
    monthlyEnabled: parseBooleanSetting(
      values[SETTING_KEYS.portfolioMonthly],
      DEFAULT_PORTFOLIO_ALERT_SETTINGS.monthlyEnabled,
    ),
    monthlyDay: parseMonthDay(values[SETTING_KEYS.portfolioMonthlyDay]) ?? DEFAULT_PORTFOLIO_ALERT_SETTINGS.monthlyDay,
    thresholdPct: parseOptionalThresholdPct(threshold)?.value ?? null,
    sendUnchanged: parseBooleanSetting(
      values[SETTING_KEYS.portfolioSendUnchanged],
      DEFAULT_PORTFOLIO_ALERT_SETTINGS.sendUnchanged,
    ),
    autoNote: parseBooleanSetting(
      values[SETTING_KEYS.portfolioAutoNote],
      DEFAULT_PORTFOLIO_ALERT_SETTINGS.autoNote,
    ),
    telegramTemplate: clampText(values[SETTING_KEYS.portfolioTelegramTemplate], MAX_PORTFOLIO_TEMPLATE_LENGTH),
    telegramNote: clampText(values[SETTING_KEYS.portfolioTelegramNote], MAX_PORTFOLIO_NOTE_LENGTH),
  };
}

/** Trims selection noise but keeps the author's internal line breaks. */
function clampText(raw: string | null | undefined, max: number): string {
  return String(raw ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function parseAlertSettings(values: Record<string, string | null | undefined>): AlertSettings {
  const channels = parseChannels(values[SETTING_KEYS.channels]);
  const threshold = parseThresholdPct(values[SETTING_KEYS.thresholdPct]);
  const minutes = parseRefreshMinutes(values[SETTING_KEYS.backgroundRefreshMinutes]);
  return {
    enabled: parseBooleanSetting(values[SETTING_KEYS.enabled], DEFAULT_ALERT_SETTINGS.enabled),
    thresholdPct: threshold ?? DEFAULT_ALERT_SETTINGS.thresholdPct,
    window: parseAlertWindow(values[SETTING_KEYS.window]) ?? DEFAULT_ALERT_SETTINGS.window,
    // An explicitly empty channel list is respected ("no channels").
    channels:
      values[SETTING_KEYS.channels] === undefined || values[SETTING_KEYS.channels] === null
        ? DEFAULT_ALERT_SETTINGS.channels
        : channels,
    backgroundRefreshMinutes: minutes ?? DEFAULT_ALERT_SETTINGS.backgroundRefreshMinutes,
    portfolio: parsePortfolioAlertSettings(values),
  };
}

export function settingsToRows(settings: AlertSettings): Array<{ key: string; value: string }> {
  return [
    { key: SETTING_KEYS.enabled, value: settings.enabled ? "true" : "false" },
    { key: SETTING_KEYS.thresholdPct, value: String(settings.thresholdPct) },
    { key: SETTING_KEYS.window, value: settings.window },
    { key: SETTING_KEYS.channels, value: settings.channels.join(",") },
    { key: SETTING_KEYS.backgroundRefreshMinutes, value: String(settings.backgroundRefreshMinutes) },
    { key: SETTING_KEYS.portfolioEnabled, value: settings.portfolio.enabled ? "true" : "false" },
    { key: SETTING_KEYS.portfolioTime, value: settings.portfolio.time },
    { key: SETTING_KEYS.portfolioTimezone, value: settings.portfolio.timezone },
    { key: SETTING_KEYS.portfolioDaily, value: settings.portfolio.dailyEnabled ? "true" : "false" },
    { key: SETTING_KEYS.portfolioWeekly, value: settings.portfolio.weeklyEnabled ? "true" : "false" },
    { key: SETTING_KEYS.portfolioWeeklyDay, value: String(settings.portfolio.weeklyDay) },
    { key: SETTING_KEYS.portfolioMonthly, value: settings.portfolio.monthlyEnabled ? "true" : "false" },
    { key: SETTING_KEYS.portfolioMonthlyDay, value: String(settings.portfolio.monthlyDay) },
    {
      key: SETTING_KEYS.portfolioThresholdPct,
      value: settings.portfolio.thresholdPct === null ? "" : String(settings.portfolio.thresholdPct),
    },
    { key: SETTING_KEYS.portfolioSendUnchanged, value: settings.portfolio.sendUnchanged ? "true" : "false" },
    { key: SETTING_KEYS.portfolioAutoNote, value: settings.portfolio.autoNote ? "true" : "false" },
    { key: SETTING_KEYS.portfolioTelegramTemplate, value: settings.portfolio.telegramTemplate },
    { key: SETTING_KEYS.portfolioTelegramNote, value: settings.portfolio.telegramNote },
  ];
}


export type PriceMove = {
  assetId: number;
  name: string;
  symbol: string;
  from: number;
  to: number;
  /** Signed fraction: 0.0624 = +6.24 %. */
  changePct: number;
  direction: "up" | "down";
  /** Human wording for the baseline, e.g. "yesterday's close". */
  baseline: string;
};

export type PricedAsset = {
  id: number;
  name: string;
  symbol: string;
  type: string;
  currentPrice: number;
};

export type PriceBaseline = { price: number; label: string };

/**
 * Compares current prices against a baseline (previous close, or the price at
 * the last refresh) and returns only moves at or beyond the threshold.
 */
export function detectPriceMoves(
  baselines: Map<number, PriceBaseline>,
  current: PricedAsset[],
  thresholdPct: number,
): PriceMove[] {
  if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) return [];
  const threshold = thresholdPct / 100;
  const moves: PriceMove[] = [];

  for (const asset of current) {
    if (asset.type === "cash") continue;
    const baseline = baselines.get(asset.id);
    if (!baseline || !Number.isFinite(baseline.price) || baseline.price <= 0) continue;
    if (!Number.isFinite(asset.currentPrice) || asset.currentPrice <= 0) continue;
    if (asset.currentPrice === baseline.price) continue;

    const changePct = (asset.currentPrice - baseline.price) / baseline.price;
    // 1e-9 absorbs floating point noise at the exact threshold.
    if (Math.abs(changePct) + 1e-9 < threshold) continue;

    moves.push({
      assetId: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      from: baseline.price,
      to: asset.currentPrice,
      changePct,
      direction: changePct > 0 ? "up" : "down",
      baseline: baseline.label,
    });
  }

  return moves.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/**
 * One alert per asset, per window, per direction, per day, per 5-point severity
 * bucket, so a 15 % crash still alerts after a 6 % dip but a flat market does
 * not repeat. Day and month rules never dedupe each other.
 */
export function priceAlertKey(move: PriceMove, date: string, window: AlertWindow = "day"): string {
  const severity = Math.max(1, Math.floor(Math.abs(move.changePct) * 100 / 5));
  return `price:${move.assetId}:${date}:${window}:${move.direction}:${severity}`;
}

export function refreshFailureKey(date: string): string {
  return `refresh-failure:${date}`;
}

/**
 * One portfolio update per cadence period, regardless of how often the refresh
 * runs: the daily key is per local day, the weekly per scheduled weekday, the
 * monthly per calendar month. Two cadences never dedupe each other — a weekly
 * recap landing on the same day as the daily one is intended.
 */
export function portfolioAlertKey(run: Pick<PortfolioRun, "cadence" | "periodKey">): string {
  return `portfolio:${run.cadence}:${run.periodKey}`;
}

export type PortfolioMove = {
  from: number;
  to: number;
  /** Signed money change: 1234.56 = +$1,234.56. */
  changeMoney: number;
  /** Signed fraction: 0.0235 = +2.35 %. */
  changePct: number;
  direction: "up" | "down" | "flat";
  /** Human wording for the baseline, e.g. "yesterday's close". */
  baseline: string;
};

/** Whole-portfolio move; `null` when there is no usable baseline. */
export function describePortfolioMove(from: number, to: number, baseline: string): PortfolioMove | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to < 0) return null;
  const changeMoney = to - from;
  const changePct = changeMoney / from;
  const flat = Math.abs(changePct) < 1e-9;
  return {
    from,
    to,
    changeMoney,
    changePct,
    direction: flat ? "flat" : changePct > 0 ? "up" : "down",
    baseline,
  };
}

/**
 * The threshold is optional by design: `null` means "always send at the chosen
 * time", which is what most people want for a daily portfolio update.
 *
 * `sendUnchanged` is for the narrower request "keep telling me my total even on
 * the days it did not move": with a threshold set, a completely flat day is
 * otherwise the one thing that gets skipped. Small moves below the threshold
 * still respect it — the flag is about 0.00 %, not about ignoring the filter.
 */
export function portfolioMovePassesThreshold(
  move: PortfolioMove,
  thresholdPct: number | null,
  sendUnchanged = false,
): boolean {
  if (thresholdPct === null) return true;
  if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) return true;
  if (sendUnchanged && move.direction === "flat") return true;
  return Math.abs(move.changePct) * 100 + 1e-9 >= thresholdPct;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 1 ? 6 : 2,
  }).format(value);
}

export function formatMovePercent(changePct: number): string {
  if (Math.abs(changePct) < 1e-9) return "0.00%";
  const sign = changePct > 0 ? "+" : "-";
  return `${sign}${Math.abs(changePct * 100).toFixed(2)}%`;
}

/** `$1,234.56` without a sign, `+$1,234.56` / `-$1,234.56` with one. */
export function formatSignedAmount(value: number): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  if (value > 0) return `+${amount}`;
  if (value < 0) return `-${amount}`;
  return amount;
}

/**
 * Money and percent, in both the title and the body, because the app is usually
 * read on a lock screen: `Portfolio ▲ +2.35% (+$1,234.56)`.
 */
export function formatPortfolioMove(move: PortfolioMove): { title: string; body: string } {
  const arrow = move.direction === "up" ? "▲" : move.direction === "down" ? "▼" : "▬";
  const percent = formatMovePercent(move.changePct);
  const amount = formatSignedAmount(move.changeMoney);
  const title = `Portfolio ${arrow} ${percent} (${amount})`;

  if (move.direction === "flat") {
    // No "unchanged since …" clause: the title already says 0.00 %, and on a
    // weekly or monthly recap the baseline sentence only adds noise to a line
    // that is, by definition, telling you nothing moved.
    return {
      title,
      body: `Your portfolio is worth ${formatAmount(move.to)}.`,
    };
  }
  return {
    title,
    body: `Your portfolio moved from ${formatAmount(move.from)} to ${formatAmount(move.to)} since ${move.baseline}: ${amount} (${percent}).`,
  };
}

/**
 * Placeholders accepted in the custom Telegram message, with the wording shown
 * next to the editor. Keeping the list here means the UI, the parser and the
 * tests can never drift apart.
 */
export const PORTFOLIO_MESSAGE_PLACEHOLDERS = [
  { token: "total", description: "Portfolio value now", sample: "$53,222.00" },
  { token: "percent", description: "Signed change", sample: "+2.35%" },
  { token: "amount", description: "Signed money change", sample: "+$1,222.00" },
  { token: "from", description: "Value it moved from", sample: "$52,000.00" },
  { token: "arrow", description: "▲ ▼ or ▬", sample: "▲" },
  { token: "direction", description: "up, down or flat", sample: "up" },
  { token: "baseline", description: "What it is compared with", sample: "yesterday's close" },
  { token: "window", description: "Comparison window", sample: "1 day" },
  { token: "date", description: "Send date (YYYY-MM-DD, chosen zone)", sample: "2026-10-22" },
  { token: "time", description: "Scheduled time (HH:MM)", sample: "18:00" },
  { token: "title", description: "Standard title line", sample: "Portfolio ▲ +2.35% (+$1,222.00)" },
  { token: "body", description: "Standard body line", sample: "Your portfolio moved from …" },
] as const;

export type PortfolioPlaceholderToken = (typeof PORTFOLIO_MESSAGE_PLACEHOLDERS)[number]["token"];

export type PortfolioMessageValues = Record<PortfolioPlaceholderToken, string>;

/** Context the scheduled send knows: when it runs and over which window. */
export type PortfolioMessageContext = {
  /** Local date of the send, `YYYY-MM-DD`. */
  date: string;
  /** Local scheduled time, `HH:MM`. */
  time: string;
  window: AlertWindow;
  /**
   * The auto-written line for this period, when the setting is on. Passed in
   * rather than generated here so the preview and the real send use exactly the
   * same line.
   */
  autoNote?: string;
};

const PLACEHOLDER_PATTERN = /\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}/g;

export function portfolioMessageValues(
  update: { title: string; body: string; move: PortfolioMove },
  context: PortfolioMessageContext,
): PortfolioMessageValues {
  const { move } = update;
  return {
    total: formatAmount(move.to),
    percent: formatMovePercent(move.changePct),
    amount: formatSignedAmount(move.changeMoney),
    from: formatAmount(move.from),
    arrow: move.direction === "up" ? "▲" : move.direction === "down" ? "▼" : "▬",
    direction: move.direction,
    baseline: move.baseline,
    window: `${WINDOW_DAYS[context.window]} ${WINDOW_DAYS[context.window] === 1 ? "day" : "days"}`,
    date: context.date,
    time: context.time,
    title: update.title,
    body: update.body,
  };
}

/** Fills `{total}`, `{ Percent }`, … Unknown tokens are left untouched. */
export function renderPortfolioTemplate(template: string, values: PortfolioMessageValues): string {
  return template.replace(PLACEHOLDER_PATTERN, (match, rawName: string) => {
    const name = rawName.trim().toLowerCase();
    return name in values ? values[name as PortfolioPlaceholderToken] : match;
  });
}

/** Token names the template uses that this app does not know (typos, mostly). */
export function unknownPortfolioPlaceholders(template: string): string[] {
  const known = new Set<string>(PORTFOLIO_MESSAGE_PLACEHOLDERS.map((placeholder) => placeholder.token));
  const unknown = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1].trim().toLowerCase();
    if (!known.has(name)) unknown.add(match[1].trim());
  }
  return [...unknown];
}

/**
 * The exact text Telegram receives for the portfolio update.
 *
 * - No template → the standard two lines (title + body), as before.
 * - A template replaces those two lines; `{title}` / `{body}` can still include
 *   them, so a prefix like "Daily report · {date}" is a one-line change.
 * - The optional note is appended on its own line, after either form.
 * - Browser push never uses this: it keeps the structured title/body.
 */
export function composePortfolioTelegramMessage(
  update: { title: string; body: string; move: PortfolioMove },
  settings: Pick<PortfolioAlertSettings, "telegramTemplate" | "telegramNote">,
  context: PortfolioMessageContext,
): string {
  const values = portfolioMessageValues(update, context);
  const template = settings.telegramTemplate.trim();
  const message = template ? renderPortfolioTemplate(template, values) : `${update.title}\n${update.body}`;
  // The manual note comes first, then the auto line, so a person's own words
  // are never pushed below a generated one.
  const extra = [settings.telegramNote.trim(), context.autoNote?.trim() ?? ""].filter(Boolean).join("\n");
  const text = extra ? `${message}\n\n${extra}` : message;
  // Telegram rejects anything longer; cut instead of losing the whole message.
  return text.length > MAX_TELEGRAM_TEXT_LENGTH
    ? `${text.slice(0, MAX_TELEGRAM_TEXT_LENGTH - 1)}…`
    : text;
}

export function formatPriceMove(move: PriceMove): { title: string; body: string } {
  const label = move.symbol || move.name;
  const arrow = move.direction === "up" ? "▲" : "▼";
  return {
    title: `${label} ${arrow} ${formatMovePercent(move.changePct)}`,
    body: `${move.name} moved from ${formatAmount(move.from)} to ${formatAmount(move.to)} since ${move.baseline}.`,
  };
}

export function formatRefreshFailure(date: string, attempted: number): { title: string; body: string } {
  return {
    title: "Price refresh failed",
    body: `No live price could be fetched for ${attempted} asset${attempted === 1 ? "" : "s"} on ${date}. Prices were left unchanged and will be retried on the next refresh.`,
  };
}

/** Plain-text message used for Telegram (no parse_mode, so nothing to escape). */
export function formatAlertText(alert: { title: string; body: string }): string {
  return `${alert.title}\n${alert.body}`;
}

/**
 * What a test or preview send reports back to `/alerts`. Only the channels that
 * were asked for get a line, so a Telegram-only setup is never told "no browser
 * subscribed".
 */
export type DeliveryOutcome = {
  pushSent: number;
  telegramSent: boolean;
  pushError?: string;
  telegramError?: string;
};

export type DeliveryMessage = { ok: boolean; message?: string; error?: string };

export function describeChannelNotes(result: DeliveryOutcome, channels: AlertChannel[]): string {
  const notes: string[] = [];
  if (channels.includes("push")) {
    notes.push(
      result.pushSent > 0
        ? `${result.pushSent} browser${result.pushSent === 1 ? "" : "s"} notified`
        : "no browser subscribed",
    );
  }
  if (channels.includes("telegram")) {
    notes.push(result.telegramSent ? "Telegram sent" : "Telegram not sent");
  }
  return notes.join(", ");
}

function deliveryDetails(result: DeliveryOutcome): string {
  const details = [result.telegramError, result.pushError].filter(Boolean).join(" · ");
  return details ? ` ${details}` : "";
}

function nothingDelivered(result: DeliveryOutcome): boolean {
  return result.pushSent === 0 && !result.telegramSent;
}

/** Result line for the two test buttons on `/alerts`. */
export function describeTestDelivery(result: DeliveryOutcome, channels: AlertChannel[]): DeliveryMessage {
  if (nothingDelivered(result)) {
    return {
      ok: false,
      error: `Nothing was delivered — ${describeChannelNotes(result, channels)}.${deliveryDetails(result)}`,
    };
  }
  return { ok: true, message: `Test alert: ${describeChannelNotes(result, channels)}.${deliveryDetails(result)}` };
}

/** Result line for “Send portfolio update now”, including the message sent. */
export function describePreviewDelivery(
  result: DeliveryOutcome,
  channels: AlertChannel[],
  title: string,
): DeliveryMessage {
  if (nothingDelivered(result)) {
    return {
      ok: false,
      error: `Nothing was delivered — ${describeChannelNotes(result, channels)}.${deliveryDetails(result)}`,
    };
  }
  return {
    ok: true,
    message: `Preview sent — “${title}” · ${describeChannelNotes(result, channels)}.${deliveryDetails(result)}`,
  };
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type TelegramConfig = { token: string; chatId: string };

const TELEGRAM_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const TELEGRAM_CHAT_PATTERN = /^(-?\d{5,}|@[A-Za-z][A-Za-z0-9_]{4,})$/;

/** Reads Telegram credentials from the environment; returns null when absent. */
export function telegramConfigFromEnv(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!TELEGRAM_TOKEN_PATTERN.test(token) || !TELEGRAM_CHAT_PATTERN.test(chatId)) return null;
  return { token, chatId };
}

/**
 * Telegram sendMessage request. Kept separate from the fetch call so tests can
 * assert on the URL/body without any network. The token never appears in errors.
 */
export function telegramRequest(config: TelegramConfig, text: string): { url: string; init: RequestInit } {
  return {
    url: `https://api.telegram.org/bot${config.token}/sendMessage`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  };
}

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** Validates a browser PushSubscription before it is stored. */
export function parsePushSubscription(value: unknown): SubscriptionInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  const keys = typeof record.keys === "object" && record.keys !== null ? (record.keys as Record<string, unknown>) : null;
  const p256dh = keys && typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = keys && typeof keys.auth === "string" ? keys.auth.trim() : "";

  if (!endpoint || endpoint.length > 2048) return null;
  if (!p256dh || !auth) return null;
  // Endpoints are HTTPS URLs on the push service.
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return null;
  if (p256dh.length > 255 || auth.length > 255) return null;
  if (!/^[A-Za-z0-9\-_+/=]+$/.test(p256dh) || !/^[A-Za-z0-9\-_+/=]+$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}
