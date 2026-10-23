import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_PORTFOLIO_ALERT_SETTINGS,
  SETTING_KEYS,
  baselineCutoffDate,
  daysBetweenIso,
  describeBaseline,
  MAX_TELEGRAM_TEXT_LENGTH,
  composePortfolioTelegramMessage,
  describeChannelNotes,
  describePortfolioMove,
  describePreviewBaseline,
  describePreviewDelivery,
  describeTestDelivery,
  duePortfolioRuns,
  portfolioMessageValues,
  renderPortfolioTemplate,
  unknownPortfolioPlaceholders,
  detectPriceMoves,
  formatAlertText,
  formatMovePercent,
  formatPortfolioMove,
  formatPriceMove,
  formatRefreshFailure,
  isValidTimeZone,
  nextPortfolioAlertAt,
  normaliseAlertTime,
  parseAlertSettings,
  parseAlertTimeMinutes,
  parseAlertWindow,
  parseChannels,
  parseOptionalThresholdPct,
  parsePortfolioAlertSettings,
  parsePushSubscription,
  parseRefreshMinutes,
  parseThresholdPct,
  portfolioAlertKey,
  portfolioMovePassesThreshold,
  portfolioScheduleFor,
  priceAlertKey,
  refreshFailureKey,
  resolveTimeZone,
  settingsToRows,
  shiftIsoDate,
  telegramConfigFromEnv,
  telegramRequest,
  zonedClock,
  zonedTimeToUtc,
  type PortfolioAlertSettings,
} from "../src/lib/alert-rules";
import { sendTelegramMessage } from "../src/lib/alerts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

test("parseAlertSettings falls back to defaults and honours stored values", () => {
  assert.deepEqual(parseAlertSettings({}), DEFAULT_ALERT_SETTINGS);

  const parsed = parseAlertSettings({
    [SETTING_KEYS.enabled]: "false",
    [SETTING_KEYS.thresholdPct]: "2.5",
    [SETTING_KEYS.window]: "month",
    [SETTING_KEYS.channels]: "telegram",
    [SETTING_KEYS.backgroundRefreshMinutes]: "30",
  });
  assert.deepEqual(parsed, {
    enabled: false,
    thresholdPct: 2.5,
    window: "month",
    channels: ["telegram"],
    backgroundRefreshMinutes: 30,
    portfolio: DEFAULT_PORTFOLIO_ALERT_SETTINGS,
  });

  // An explicitly empty channel list means "record alerts, deliver nothing".
  assert.deepEqual(parseAlertSettings({ [SETTING_KEYS.channels]: "" }).channels, []);
  // Unknown channels are ignored, order is canonical.
  assert.deepEqual(parseChannels("telegram,push,email"), ["push", "telegram"]);
});

test("comparison windows parse, default to a day, and shift dates safely", () => {
  assert.equal(parseAlertWindow("day"), "day");
  assert.equal(parseAlertWindow(" DAY "), "day");
  assert.equal(parseAlertWindow("month"), "month");
  assert.equal(parseAlertWindow("monthly"), "month");
  assert.equal(parseAlertWindow("week"), "week");
  assert.equal(parseAlertWindow("7d"), "week");
  assert.equal(parseAlertWindow("year"), null);
  assert.equal(parseAlertWindow(""), null);
  assert.equal(parseAlertWindow(null), null);

  // Unknown or missing values fall back to the daily rule.
  assert.equal(parseAlertSettings({ [SETTING_KEYS.window]: "year" }).window, "day");
  assert.equal(parseAlertSettings({}).window, DEFAULT_ALERT_SETTINGS.window);

  assert.equal(shiftIsoDate("2026-10-22", -1), "2026-10-21");
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftIsoDate("2026-01-01", -30), "2025-12-02");
  assert.equal(daysBetweenIso("2026-09-22", "2026-10-22"), 30);
  assert.equal(daysBetweenIso("2026-10-22", "2026-10-22"), 0);

  assert.equal(baselineCutoffDate("day", "2026-10-22"), "2026-10-21");
  assert.equal(baselineCutoffDate("month", "2026-10-22"), "2026-09-22");

  assert.equal(describeBaseline("day", 1), "yesterday's close");
  assert.equal(describeBaseline("month", 30), "the price 30 days ago");
  // Short history must not be described as a full month.
  assert.equal(describeBaseline("month", 5, true), "the earliest recorded price (5 days ago)");
});

test("invalid settings fall back instead of breaking the page", () => {
  assert.equal(parseThresholdPct("0"), null);
  assert.equal(parseThresholdPct("80"), null);
  assert.equal(parseThresholdPct("abc"), null);
  assert.equal(parseThresholdPct("5.55"), 5.6);
  assert.equal(parseThresholdPct("0.5"), 0.5);

  assert.equal(parseRefreshMinutes("0"), 0);
  assert.equal(parseRefreshMinutes("3"), null);
  assert.equal(parseRefreshMinutes("1440"), null);
  assert.equal(parseRefreshMinutes("15"), 15);

  const parsed = parseAlertSettings({
    [SETTING_KEYS.thresholdPct]: "999",
    [SETTING_KEYS.backgroundRefreshMinutes]: "-5",
  });
  assert.equal(parsed.thresholdPct, DEFAULT_ALERT_SETTINGS.thresholdPct);
  assert.equal(parsed.backgroundRefreshMinutes, DEFAULT_ALERT_SETTINGS.backgroundRefreshMinutes);
});

test("settings rows round-trip through the parser", () => {
  const settings = {
    enabled: false,
    thresholdPct: 7.5,
    window: "month" as const,
    channels: ["push"] as const,
    backgroundRefreshMinutes: 60,
    portfolio: {
      enabled: true,
      time: "18:30",
      timezone: "Asia/Phnom_Penh",
      dailyEnabled: true,
      weeklyEnabled: true,
      weeklyDay: 3,
      monthlyEnabled: false,
      monthlyDay: 12,
      thresholdPct: null,
      telegramTemplate: "Portfolio {arrow} {percent}",
      telegramNote: "— sent from Ledgerly",
    },
  };
  const rows = settingsToRows({ ...settings, channels: [...settings.channels] });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  assert.deepEqual(parseAlertSettings(map), {
    enabled: false,
    thresholdPct: 7.5,
    window: "month",
    channels: ["push"],
    backgroundRefreshMinutes: 60,
    portfolio: {
      enabled: true,
      time: "18:30",
      timezone: "Asia/Phnom_Penh",
      dailyEnabled: true,
      weeklyEnabled: true,
      weeklyDay: 3,
      monthlyEnabled: false,
      monthlyDay: 12,
      thresholdPct: null,
      telegramTemplate: "Portfolio {arrow} {percent}",
      telegramNote: "— sent from Ledgerly",
    },
  });
});

const assets = [
  { id: 1, name: "Bitcoin", symbol: "BTC", type: "crypto", currentPrice: 106_000 },
  { id: 2, name: "Ethereum", symbol: "ETH", type: "crypto", currentPrice: 3_000 },
  { id: 3, name: "Apple", symbol: "AAPL", type: "stock", currentPrice: 200 },
  { id: 4, name: "Checking", symbol: "USD", type: "cash", currentPrice: 1 },
  { id: 5, name: "No baseline", symbol: "NONE", type: "crypto", currentPrice: 50 },
];

const baselines = new Map([
  [1, { price: 100_000, label: "yesterday's close" }],
  [2, { price: 3_030, label: "yesterday's close" }],
  [3, { price: 190, label: "yesterday's close" }],
  [4, { price: 1, label: "the last refresh" }],
]);

test("detectPriceMoves keeps only moves beyond the threshold, largest first", () => {
  const moves = detectPriceMoves(baselines, assets, 5);
  assert.deepEqual(moves.map((move) => move.symbol), ["BTC", "AAPL"]);
  assert.equal(moves[0].direction, "up");
  assert.ok(Math.abs(moves[0].changePct - 0.06) < 1e-9);
  assert.equal(moves[0].baseline, "yesterday's close");
  // ETH moved -0.99 %, below the threshold; cash and assets without a baseline are skipped.
  assert.ok(!moves.some((move) => move.symbol === "ETH" || move.symbol === "USD" || move.symbol === "NONE"));
});

test("detectPriceMoves handles threshold edges, drops and invalid prices", () => {
  const atThreshold = detectPriceMoves(new Map([[1, { price: 100, label: "x" }]]), [
    { id: 1, name: "A", symbol: "A", type: "crypto", currentPrice: 95 },
  ], 5);
  assert.equal(atThreshold.length, 1);
  assert.equal(atThreshold[0].direction, "down");

  const below = detectPriceMoves(new Map([[1, { price: 100, label: "x" }]]), [
    { id: 1, name: "A", symbol: "A", type: "crypto", currentPrice: 95.01 },
  ], 5);
  assert.equal(below.length, 0);

  const invalid = detectPriceMoves(new Map([[1, { price: 0, label: "x" }]]), [
    { id: 1, name: "A", symbol: "A", type: "crypto", currentPrice: Number.NaN },
  ], 5);
  assert.equal(invalid.length, 0);

  assert.deepEqual(detectPriceMoves(baselines, assets, 0), []);
});

test("price alert keys dedupe per day but escalate with severity", () => {
  const base = {
    assetId: 7,
    name: "Solana",
    symbol: "SOL",
    from: 100,
    to: 106,
    changePct: 0.06,
    direction: "up" as const,
    baseline: "yesterday's close",
  };
  const small = priceAlertKey(base, "2026-10-22");
  const same = priceAlertKey({ ...base, changePct: 0.08 }, "2026-10-22");
  const bigger = priceAlertKey({ ...base, changePct: 0.16 }, "2026-10-22");
  const otherDay = priceAlertKey(base, "2026-10-23");
  const down = priceAlertKey({ ...base, direction: "down", changePct: -0.06 }, "2026-10-22");

  assert.equal(small, "price:7:2026-10-22:day:up:1");
  assert.equal(same, small);
  assert.notEqual(bigger, small);
  assert.equal(bigger, "price:7:2026-10-22:day:up:3");
  assert.notEqual(otherDay, small);
  assert.notEqual(down, small);

  // A month rule records its own alerts, so it never shadows the day rule.
  const monthly = priceAlertKey(base, "2026-10-22", "month");
  assert.equal(monthly, "price:7:2026-10-22:month:up:1");
  assert.notEqual(monthly, small);
  assert.equal(refreshFailureKey("2026-10-22"), "refresh-failure:2026-10-22");
});

test("alert messages are human readable and currency formatted", () => {
  const move = {
    assetId: 1,
    name: "Bitcoin",
    symbol: "BTC",
    from: 100_000,
    to: 106_240,
    changePct: 0.0624,
    direction: "up" as const,
    baseline: "yesterday's close",
  };
  const alert = formatPriceMove(move);
  assert.equal(alert.title, "BTC ▲ +6.24%");
  assert.equal(alert.body, "Bitcoin moved from $100,000.00 to $106,240.00 since yesterday's close.");
  assert.equal(formatAlertText(alert), "BTC ▲ +6.24%\nBitcoin moved from $100,000.00 to $106,240.00 since yesterday's close.");

  const down = formatPriceMove({ ...move, direction: "down", changePct: -0.031, to: 96_900 });
  assert.equal(down.title, "BTC ▼ -3.10%");
  assert.equal(formatMovePercent(-0.031), "-3.10%");

  const failure = formatRefreshFailure("2026-10-22", 3);
  assert.equal(failure.title, "Price refresh failed");
  assert.match(failure.body, /3 assets/);
});

test("telegram configuration is validated before use", () => {
  const token = `123456:${"A".repeat(35)}`;
  assert.equal(telegramConfigFromEnv({}), null);
  assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: token }), null);
  assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "not-a-token", TELEGRAM_CHAT_ID: "123456" }), null);
  assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "abc" }), null);
  assert.deepEqual(
    telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: ` ${token} `, TELEGRAM_CHAT_ID: " -1001234567890 " }),
    { token, chatId: "-1001234567890" },
  );
  assert.deepEqual(
    telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "@my_channel" }),
    { token, chatId: "@my_channel" },
  );
});

test("telegram requests post JSON to the bot API", () => {
  const config = { token: `123456:${"B".repeat(35)}`, chatId: "42" };
  const request = telegramRequest(config, "hello\nworld");
  assert.equal(request.url, `https://api.telegram.org/bot${config.token}/sendMessage`);
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    chat_id: "42",
    text: "hello\nworld",
    disable_web_page_preview: true,
  });
});

test("push subscriptions must be https endpoints with valid keys", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc-123",
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
  };
  assert.deepEqual(parsePushSubscription(valid), {
    endpoint: valid.endpoint,
    p256dh: valid.keys.p256dh,
    auth: valid.keys.auth,
  });

  for (const invalid of [
    null,
    {},
    { endpoint: valid.endpoint },
    { endpoint: "http://insecure.example/push", keys: valid.keys },
    { endpoint: "not-a-url", keys: valid.keys },
    { endpoint: valid.endpoint, keys: { p256dh: "bad key with spaces", auth: "x" } },
    { endpoint: valid.endpoint, keys: { p256dh: valid.keys.p256dh } },
    { endpoint: `https://example.com/${"a".repeat(3000)}`, keys: valid.keys },
  ]) {
    assert.equal(parsePushSubscription(invalid), null);
  }
});

test("sendTelegramMessage reports success and safe failures", async () => {
  const token = `987654:${"C".repeat(35)}`;
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.TELEGRAM_CHAT_ID = "123456789";

  let seenUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seenUrl = String(input);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  assert.deepEqual(await sendTelegramMessage("hi"), { ok: true });
  assert.ok(seenUrl.includes("/sendMessage"));

  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  const unauthorized = await sendTelegramMessage("hi");
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.error ?? "", /bot token/i);
  assert.ok(!(unauthorized.error ?? "").includes(token));

  globalThis.fetch = (async () => new Response("{}", { status: 429 })) as typeof fetch;
  assert.match((await sendTelegramMessage("hi")).error ?? "", /rate limit/i);

  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.match((await sendTelegramMessage("hi")).error ?? "", /unreachable/i);
});

test("sendTelegramMessage reports missing configuration without calling out", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;

  const result = await sendTelegramMessage("hi");
  assert.equal(result.ok, false);
  assert.equal(result.error, "Telegram is not configured");
  assert.equal(called, false);
});

test("portfolio update settings: time is what matters, threshold is optional", () => {
  assert.equal(normaliseAlertTime("7:05"), "07:05");
  assert.equal(normaliseAlertTime("18:00"), "18:00");
  assert.equal(normaliseAlertTime(""), "");
  assert.equal(normaliseAlertTime(null), "");
  assert.equal(normaliseAlertTime("25:00"), null);
  assert.equal(normaliseAlertTime("18:60"), null);
  assert.equal(parseAlertTimeMinutes("18:30"), 1110);
  assert.equal(parseAlertTimeMinutes(""), null);

  // Blank means "no threshold": the update is sent every day at the chosen time.
  assert.deepEqual(parseOptionalThresholdPct(""), { value: null });
  assert.deepEqual(parseOptionalThresholdPct("  "), { value: null });
  assert.deepEqual(parseOptionalThresholdPct("3.5"), { value: 3.5 });
  assert.equal(parseOptionalThresholdPct("abc"), null);
  assert.equal(parseOptionalThresholdPct("80"), null);

  const parsed = parsePortfolioAlertSettings({
    [SETTING_KEYS.portfolioEnabled]: "yes",
    [SETTING_KEYS.portfolioTime]: "7:05",
    [SETTING_KEYS.portfolioTimezone]: "Asia/Phnom_Penh",
    [SETTING_KEYS.portfolioDaily]: "true",
    [SETTING_KEYS.portfolioWeekly]: "true",
    [SETTING_KEYS.portfolioWeeklyDay]: "5",
    [SETTING_KEYS.portfolioMonthly]: "false",
    [SETTING_KEYS.portfolioMonthlyDay]: "12",
    [SETTING_KEYS.portfolioThresholdPct]: "2.5",
  });
  assert.deepEqual(parsed, {
    enabled: true,
    time: "07:05",
    timezone: "Asia/Phnom_Penh",
    dailyEnabled: true,
    weeklyEnabled: true,
    weeklyDay: 5,
    monthlyEnabled: false,
    monthlyDay: 12,
    thresholdPct: 2.5,
    telegramTemplate: "",
    telegramNote: "",
  });

  // No stored rows → defaults; an explicitly blank time switches the schedule off.
  assert.deepEqual(parsePortfolioAlertSettings({}), DEFAULT_PORTFOLIO_ALERT_SETTINGS);
  assert.deepEqual(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioTime]: "" }), {
    ...DEFAULT_PORTFOLIO_ALERT_SETTINGS,
    time: "",
  });
  // Unreadable values fall back instead of breaking the page.
  assert.equal(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioTime]: "25:99" }).time, "18:00");
  assert.equal(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioThresholdPct]: "abc" }).thresholdPct, null);

  // Cadence pickers clamp instead of breaking: only 0–6 and 1–28 are schedules.
  assert.equal(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioWeeklyDay]: "9" }).weeklyDay, 1);
  assert.equal(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioWeeklyDay]: "0" }).weeklyDay, 0);
  assert.equal(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioMonthlyDay]: "31" }).monthlyDay, 1);
  assert.equal(parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioMonthlyDay]: "28" }).monthlyDay, 28);
  // An old single-window row is ignored, not turned into a cadence.
  assert.equal(
    parsePortfolioAlertSettings({ [SETTING_KEYS.portfolioWindow]: "month" }).dailyEnabled,
    true,
  );
});

test("daily, weekly and monthly recaps are independent schedules", () => {
  const settings: PortfolioAlertSettings = {
    ...DEFAULT_PORTFOLIO_ALERT_SETTINGS,
    enabled: true,
    time: "18:00",
    timezone: "Asia/Phnom_Penh",
    weeklyDay: 4, // Thursday
    monthlyDay: 22,
  };
  const at = (iso: string) => new Date(iso);

  // Thursday 22 Oct 2026, after 18:00 Phnom Penh (UTC+7): all three are due.
  const runs = duePortfolioRuns(at("2026-10-22T12:00:00Z"), settings, "Asia/Phnom_Penh");
  assert.deepEqual(
    runs.map((run) => run.cadence),
    ["day", "week", "month"],
  );
  // Monthly dedupes per calendar month, daily per day, weekly per its weekday.
  assert.deepEqual(
    runs.map((run) => run.periodKey),
    ["2026-10-22", "2026-10-22", "2026-10"],
  );
  assert.deepEqual(new Set(runs.map((run) => portfolioAlertKey(run))).size, 3);

  // Friday: only the daily recap is due, never the weekly one.
  const friday = duePortfolioRuns(at("2026-10-23T12:00:00Z"), settings, "Asia/Phnom_Penh");
  assert.deepEqual(friday.map((run) => run.cadence), ["day"]);

  // Saturday the 24th: daily only. The weekly slot waits for next Thursday.
  assert.deepEqual(
    duePortfolioRuns(at("2026-10-24T12:00:00Z"), settings, "Asia/Phnom_Penh").map((run) => run.cadence),
    ["day"],
  );

  // Ticking only the weekly recap leaves one send per Thursday.
  const weeklyOnly = duePortfolioRuns(
    at("2026-10-22T12:00:00Z"),
    { ...settings, dailyEnabled: false, monthlyEnabled: false },
    "Asia/Phnom_Penh",
  );
  assert.deepEqual(weeklyOnly.map((run) => run.cadence), ["week"]);

  // Nothing before the chosen time, and nothing when the master switch is off.
  assert.deepEqual(duePortfolioRuns(at("2026-10-22T10:00:00Z"), settings, "Asia/Phnom_Penh"), []);
  assert.deepEqual(
    duePortfolioRuns(at("2026-10-22T12:00:00Z"), { ...settings, enabled: false }, "Asia/Phnom_Penh"),
    [],
  );
  assert.deepEqual(
    duePortfolioRuns(
      at("2026-10-22T12:00:00Z"),
      { ...settings, dailyEnabled: false, weeklyEnabled: false, monthlyEnabled: false },
      "Asia/Phnom_Penh",
    ),
    [],
  );

  // Cadence gating is explicit too.
  assert.equal(portfolioScheduleFor(at("2026-10-23T12:00:00Z"), "18:00", "Asia/Phnom_Penh", "week", settings), null);
  assert.equal(
    portfolioScheduleFor(at("2026-10-22T12:00:00Z"), "18:00", "Asia/Phnom_Penh", "week", settings)?.date,
    "2026-10-22",
  );
  assert.equal(portfolioScheduleFor(at("2026-10-23T12:00:00Z"), "18:00", "Asia/Phnom_Penh", "month", settings), null);

  // Next send skips to the next enabled cadence day, not merely tomorrow.
  const nextWeekly = nextPortfolioAlertAt(
    at("2026-10-23T12:00:00Z"),
    "18:00",
    "Asia/Phnom_Penh",
    { ...settings, dailyEnabled: false, monthlyEnabled: false },
  );
  assert.equal(nextWeekly?.toISOString(), "2026-10-29T11:00:00.000Z");
});

test("time zones decide when the portfolio update is due", () => {
  // Phnom Penh is UTC+7 all year.
  assert.deepEqual(zonedClock(new Date("2026-10-22T11:30:00Z"), "Asia/Phnom_Penh"), {
    date: "2026-10-22",
    minutes: 18 * 60 + 30,
  });
  assert.equal(zonedTimeToUtc("2026-10-22", 18 * 60, "Asia/Phnom_Penh").toISOString(), "2026-10-22T11:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-10-22", 18 * 60, "UTC").toISOString(), "2026-10-22T18:00:00.000Z");
  // Daylight saving is handled by the two-pass offset lookup.
  assert.equal(zonedTimeToUtc("2026-07-01", 9 * 60, "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-01-15", 9 * 60, "America/New_York").toISOString(), "2026-01-15T14:00:00.000Z");

  // Punctual: 18:00 in Phnom Penh is 11:00 UTC.
  const punctual = portfolioScheduleFor(new Date("2026-10-22T11:00:00Z"), "18:00", "Asia/Phnom_Penh");
  assert.equal(punctual?.date, "2026-10-22");
  assert.equal(punctual?.at.toISOString(), "2026-10-22T11:00:00.000Z");
  assert.equal(punctual?.lateMinutes, 0);

  // Nothing is due before the chosen time — including yesterday's run, which
  // must never be delivered the next morning. This is the regression that made
  // an 18:00 update arrive just after midnight.
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T10:59:00Z"), "18:00", "Asia/Phnom_Penh"), null);
  assert.equal(portfolioScheduleFor(new Date("2026-10-21T17:00:00Z"), "18:00", "Asia/Phnom_Penh"), null);
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T00:00:00Z"), "18:00", "Asia/Phnom_Penh"), null);
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T06:00:00Z"), "18:00", "Asia/Phnom_Penh"), null);

  // Later the same local day the run is still today's, just late; the key is
  // what stops repeats, not the clock.
  const later = portfolioScheduleFor(new Date("2026-10-22T15:00:00Z"), "18:00", "Asia/Phnom_Penh");
  assert.equal(later?.date, "2026-10-22");
  assert.equal(later?.lateMinutes, 4 * 60);
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T16:59:00Z"), "18:00", "Asia/Phnom_Penh")?.date, "2026-10-22");

  // The next local day starts clean: same key for the whole evening, a new key
  // (and no stale send) once the date rolls over.
  const evening = portfolioScheduleFor(new Date("2026-10-22T11:05:00Z"), "18:00", "Asia/Phnom_Penh");
  const night = portfolioScheduleFor(new Date("2026-10-22T16:00:00Z"), "18:00", "Asia/Phnom_Penh");
  assert.equal(portfolioAlertKey(evening!), portfolioAlertKey(night!));
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T17:30:00Z"), "18:00", "Asia/Phnom_Penh"), null);
  assert.equal(
    portfolioScheduleFor(new Date("2026-10-23T11:00:00Z"), "18:00", "Asia/Phnom_Penh")?.date,
    "2026-10-23",
  );

  // A scheduler that only runs late in the evening still delivers that day's update.
  const lateScheduler = portfolioScheduleFor(new Date("2026-10-22T15:00:00Z"), "18:00", "Asia/Phnom_Penh");
  assert.equal(lateScheduler?.date, "2026-10-22");

  assert.equal(portfolioScheduleFor(new Date("2026-10-22T15:00:00Z"), "", "Asia/Phnom_Penh"), null);
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T15:00:00Z"), "25:00", "Asia/Phnom_Penh"), null);

  // The time zone decides the boundary: 11:30 UTC is already 18:30 in Phnom Penh
  // but only 07:30 in New York, so the same instant is due in one zone and not
  // the other.
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T11:30:00Z"), "18:00", "Asia/Phnom_Penh")?.date, "2026-10-22");
  assert.equal(portfolioScheduleFor(new Date("2026-10-22T11:30:00Z"), "18:00", "America/New_York"), null);

  assert.equal(
    nextPortfolioAlertAt(new Date("2026-10-22T09:00:00Z"), "18:00", "Asia/Phnom_Penh")?.toISOString(),
    "2026-10-22T11:00:00.000Z",
  );
  assert.equal(
    nextPortfolioAlertAt(new Date("2026-10-22T11:30:00Z"), "18:00", "Asia/Phnom_Penh")?.toISOString(),
    "2026-10-23T11:00:00.000Z",
  );
  assert.equal(nextPortfolioAlertAt(new Date(), "", "UTC"), null);

  // Unknown zones fall back to a usable zone instead of throwing.
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.ok(resolveTimeZone("Not/AZone").length > 0);
});

test("portfolio moves report money and percent, with an optional threshold", () => {
  const up = describePortfolioMove(50_000, 51_000, "yesterday's close");
  assert.ok(up);
  assert.deepEqual(up, {
    from: 50_000,
    to: 51_000,
    changeMoney: 1_000,
    changePct: 0.02,
    direction: "up",
    baseline: "yesterday's close",
  });
  assert.equal(formatPortfolioMove(up).title, "Portfolio ▲ +2.00% (+$1,000.00)");
  assert.equal(
    formatPortfolioMove(up).body,
    "Your portfolio moved from $50,000.00 to $51,000.00 since yesterday's close: +$1,000.00 (+2.00%).",
  );

  const down = describePortfolioMove(50_000, 48_500, "the price 30 days ago");
  assert.ok(down);
  assert.equal(down.direction, "down");
  assert.equal(formatPortfolioMove(down).title, "Portfolio ▼ -3.00% (-$1,500.00)");

  const flat = describePortfolioMove(50_000, 50_000, "yesterday's close");
  assert.ok(flat);
  assert.equal(flat.direction, "flat");
  assert.equal(formatPortfolioMove(flat).title, "Portfolio ▬ 0.00% ($0.00)");
  assert.equal(formatPortfolioMove(flat).body, "Your portfolio is worth $50,000.00, unchanged since yesterday's close.");

  // No baseline or nonsense totals never produce an alert.
  assert.equal(describePortfolioMove(0, 51_000, "x"), null);
  assert.equal(describePortfolioMove(Number.NaN, 51_000, "x"), null);
  assert.equal(describePortfolioMove(50_000, -1, "x"), null);

  // Blank threshold = always send, even when nothing moved.
  assert.equal(portfolioMovePassesThreshold(flat, null), true);
  assert.equal(portfolioMovePassesThreshold(up, null), true);
  assert.equal(portfolioMovePassesThreshold(up, 2), true);
  assert.equal(portfolioMovePassesThreshold(up, 2.5), false);
  assert.equal(portfolioMovePassesThreshold(down, 3), true);
  assert.equal(portfolioMovePassesThreshold(flat, 0.5), false);

  assert.equal(portfolioAlertKey({ cadence: "day", periodKey: "2026-10-22" }), "portfolio:day:2026-10-22");
  assert.equal(portfolioAlertKey({ cadence: "week", periodKey: "2026-10-22" }), "portfolio:week:2026-10-22");
  assert.equal(portfolioAlertKey({ cadence: "month", periodKey: "2026-10" }), "portfolio:month:2026-10");
  assert.notEqual(
    portfolioAlertKey({ cadence: "day", periodKey: "2026-10-22" }),
    portfolioAlertKey({ cadence: "day", periodKey: "2026-10-23" }),
  );
});

test("test and preview results only mention the channels that were used", () => {
  // Telegram only: no "no browser subscribed" noise.
  assert.equal(describeChannelNotes({ pushSent: 0, telegramSent: true }, ["telegram"]), "Telegram sent");
  assert.equal(describeChannelNotes({ pushSent: 2, telegramSent: false }, ["push"]), "2 browsers notified");
  assert.equal(describeChannelNotes({ pushSent: 1, telegramSent: true }, ["push"]), "1 browser notified");
  assert.equal(
    describeChannelNotes({ pushSent: 0, telegramSent: false }, ["push", "telegram"]),
    "no browser subscribed, Telegram not sent",
  );

  const sent = describeTestDelivery({ pushSent: 0, telegramSent: true }, ["telegram"]);
  assert.deepEqual(sent, { ok: true, message: "Test alert: Telegram sent." });

  const failed = describeTestDelivery(
    { pushSent: 0, telegramSent: false, telegramError: "Telegram rejected the bot token" },
    ["telegram"],
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "Nothing was delivered — Telegram not sent. Telegram rejected the bot token");

  // The preview echoes the message that was sent, so a lock-screen notification
  // and the page agree.
  const preview = describePreviewDelivery({ pushSent: 1, telegramSent: true }, ["push", "telegram"], "Portfolio ▲ +2.35% (+$1,222.00)");
  assert.equal(preview.ok, true);
  assert.equal(preview.message, "Preview sent — “Portfolio ▲ +2.35% (+$1,222.00)” · 1 browser notified, Telegram sent.");

  const previewFailed = describePreviewDelivery({ pushSent: 0, telegramSent: false }, ["push"], "Portfolio ▬ 0.00% ($0.00)");
  assert.equal(previewFailed.ok, false);
  assert.equal(previewFailed.error, "Nothing was delivered — no browser subscribed.");
});

test("a preview without earlier history still names the snapshot it used", () => {
  // Today's snapshot is what a brand-new ledger has before its first full day.
  assert.equal(describePreviewBaseline("2026-10-22", "2026-10-22", "day"), "today's snapshot");
  // Older snapshots keep the same wording the scheduled message would use.
  assert.equal(describePreviewBaseline("2026-10-21", "2026-10-22", "day"), "yesterday's close");
  assert.equal(describePreviewBaseline("2026-10-19", "2026-10-22", "day"), "the close 3 days ago");
  // No snapshot at all falls back to the "last refresh" label.
  assert.equal(describePreviewBaseline(null, "2026-10-22", "day"), "the last refresh");
});

const sampleMove = describePortfolioMove(52_000, 53_222, "yesterday's close")!;
const sampleMessage = { ...formatPortfolioMove(sampleMove), move: sampleMove };
const sampleContext = { date: "2026-10-22", time: "18:00", window: "day" as const };

test("the custom Telegram message fills placeholders, keeps the note, and falls back to the standard text", () => {
  const values = portfolioMessageValues(sampleMessage, sampleContext);
  assert.equal(values.total, "$53,222.00");
  assert.equal(values.percent, "+2.35%");
  assert.equal(values.amount, "+$1,222.00");
  assert.equal(values.from, "$52,000.00");
  assert.equal(values.arrow, "▲");
  assert.equal(values.direction, "up");
  assert.equal(values.baseline, "yesterday's close");
  assert.equal(values.window, "1 day");
  assert.equal(values.date, "2026-10-22");
  assert.equal(values.time, "18:00");
  assert.equal(values.title, "Portfolio ▲ +2.35% (+$1,222.00)");
  assert.match(values.body, /^Your portfolio moved from \$52,000\.00/);

  // Blank template = exactly what the app sent before this feature.
  assert.equal(
    composePortfolioTelegramMessage(sampleMessage, { telegramTemplate: "", telegramNote: "" }, sampleContext),
    "Portfolio ▲ +2.35% (+$1,222.00)\nYour portfolio moved from $52,000.00 to $53,222.00 since yesterday's close: +$1,222.00 (+2.35%).",
  );

  // A template replaces both standard lines and can re-use them.
  const custom = composePortfolioTelegramMessage(
    sampleMessage,
    { telegramTemplate: "📊 {date} {time}\n{title}\nValue now {total}", telegramNote: "— Ledgerly" },
    sampleContext,
  );
  assert.equal(
    custom,
    "📊 2026-10-22 18:00\nPortfolio ▲ +2.35% (+$1,222.00)\nValue now $53,222.00\n\n— Ledgerly",
  );

  // Note on its own works with the standard message too.
  assert.equal(
    composePortfolioTelegramMessage(sampleMessage, { telegramTemplate: "", telegramNote: "Reminder: pay rent" }, sampleContext),
    `${sampleMessage.title}\n${sampleMessage.body}\n\nReminder: pay rent`,
  );

  // Whitespace-only values count as blank.
  assert.equal(
    composePortfolioTelegramMessage(sampleMessage, { telegramTemplate: "   ", telegramNote: "  " }, sampleContext),
    `${sampleMessage.title}\n${sampleMessage.body}`,
  );
});

test("placeholders are case- and space-insensitive, and typos are reported instead of silently dropped", () => {
  assert.equal(
    renderPortfolioTemplate("{PERCENT} / { Percent } / {percent}", portfolioMessageValues(sampleMessage, sampleContext)),
    "+2.35% / +2.35% / +2.35%",
  );
  // A token this app does not know stays exactly as typed.
  assert.equal(
    renderPortfolioTemplate("{btc} and {percent}", portfolioMessageValues(sampleMessage, sampleContext)),
    "{btc} and +2.35%",
  );
  // Plain braces without a word are left alone too (JSON, code, emoji text).
  assert.equal(renderPortfolioTemplate("{} { } {2fa}", portfolioMessageValues(sampleMessage, sampleContext)), "{} { } {2fa}");

  assert.deepEqual(unknownPortfolioPlaceholders("{percent} {btc} {Total}"), ["btc"]);
  assert.deepEqual(unknownPortfolioPlaceholders("{a} {b} {a}"), ["a", "b"]);
  assert.deepEqual(unknownPortfolioPlaceholders("no placeholders here"), []);
  assert.deepEqual(unknownPortfolioPlaceholders("{date} {time} {window}"), []);
});

test("a very long message is cut to Telegram's limit instead of being rejected", () => {
  const template = "x".repeat(MAX_TELEGRAM_TEXT_LENGTH + 500);
  const text = composePortfolioTelegramMessage(sampleMessage, { telegramTemplate: template, telegramNote: "" }, sampleContext);
  assert.equal(text.length, MAX_TELEGRAM_TEXT_LENGTH);
  assert.ok(text.endsWith("…"));
});

test("custom wording is trimmed, capped, and survives a settings round-trip", () => {
  const parsed = parsePortfolioAlertSettings({
    [SETTING_KEYS.portfolioTelegramTemplate]: "  Line one\r\n{total}  ",
    [SETTING_KEYS.portfolioTelegramNote]: "  note  ",
  });
  assert.equal(parsed.telegramTemplate, "Line one\n{total}");
  assert.equal(parsed.telegramNote, "note");

  const long = parsePortfolioAlertSettings({
    [SETTING_KEYS.portfolioTelegramTemplate]: "y".repeat(5_000),
    [SETTING_KEYS.portfolioTelegramNote]: "z".repeat(5_000),
  });
  assert.equal(long.telegramTemplate.length, 1_000);
  assert.equal(long.telegramNote.length, 500);

  // Missing rows (older databases) default to the standard message.
  const empty = parsePortfolioAlertSettings({});
  assert.equal(empty.telegramTemplate, "");
  assert.equal(empty.telegramNote, "");
});
