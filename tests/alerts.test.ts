import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DEFAULT_ALERT_SETTINGS,
  SETTING_KEYS,
  detectPriceMoves,
  formatAlertText,
  formatMovePercent,
  formatPriceMove,
  formatRefreshFailure,
  parseAlertSettings,
  parseChannels,
  parsePushSubscription,
  parseRefreshMinutes,
  parseThresholdPct,
  priceAlertKey,
  refreshFailureKey,
  settingsToRows,
  telegramConfigFromEnv,
  telegramRequest,
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
    [SETTING_KEYS.channels]: "telegram",
    [SETTING_KEYS.backgroundRefreshMinutes]: "30",
  });
  assert.deepEqual(parsed, {
    enabled: false,
    thresholdPct: 2.5,
    channels: ["telegram"],
    backgroundRefreshMinutes: 30,
  });

  // An explicitly empty channel list means "record alerts, deliver nothing".
  assert.deepEqual(parseAlertSettings({ [SETTING_KEYS.channels]: "" }).channels, []);
  // Unknown channels are ignored, order is canonical.
  assert.deepEqual(parseChannels("telegram,push,email"), ["push", "telegram"]);
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
  const settings = { enabled: false, thresholdPct: 7.5, channels: ["push"] as const, backgroundRefreshMinutes: 60 };
  const rows = settingsToRows({ ...settings, channels: [...settings.channels] });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  assert.deepEqual(parseAlertSettings(map), {
    enabled: false,
    thresholdPct: 7.5,
    channels: ["push"],
    backgroundRefreshMinutes: 60,
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

  assert.equal(small, "price:7:2026-10-22:up:1");
  assert.equal(same, small);
  assert.notEqual(bigger, small);
  assert.equal(bigger, "price:7:2026-10-22:up:3");
  assert.notEqual(otherDay, small);
  assert.notEqual(down, small);
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
