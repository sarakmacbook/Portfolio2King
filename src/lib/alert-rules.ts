/**
 * Pure alert rules: settings parsing, move detection, dedupe keys, and message
 * formatting. No database or network access, so everything here is unit-tested
 * directly (see tests/alerts.test.ts).
 */

export const ALERT_CHANNELS = ["push", "telegram"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export type AlertSettings = {
  /** Master switch for automatic alerts (does not affect manual test sends). */
  enabled: boolean;
  /** Percentage move that triggers an alert, e.g. 5 → ±5 %. */
  thresholdPct: number;
  channels: AlertChannel[];
  /** While the app is open, refresh prices at most this often. 0 disables it. */
  backgroundRefreshMinutes: number;
};

export const MIN_THRESHOLD_PCT = 0.5;
export const MAX_THRESHOLD_PCT = 50;
export const MIN_REFRESH_MINUTES = 5;
export const MAX_REFRESH_MINUTES = 720;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  thresholdPct: 5,
  channels: ["push", "telegram"],
  backgroundRefreshMinutes: 15,
};

/** Keys used in the `app_settings` table. */
export const SETTING_KEYS = {
  enabled: "alerts.enabled",
  thresholdPct: "alerts.thresholdPct",
  channels: "alerts.channels",
  backgroundRefreshMinutes: "refresh.intervalMinutes",
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

export function parseAlertSettings(values: Record<string, string | null | undefined>): AlertSettings {
  const channels = parseChannels(values[SETTING_KEYS.channels]);
  const threshold = parseThresholdPct(values[SETTING_KEYS.thresholdPct]);
  const minutes = parseRefreshMinutes(values[SETTING_KEYS.backgroundRefreshMinutes]);
  return {
    enabled: parseBooleanSetting(values[SETTING_KEYS.enabled], DEFAULT_ALERT_SETTINGS.enabled),
    thresholdPct: threshold ?? DEFAULT_ALERT_SETTINGS.thresholdPct,
    // An explicitly empty channel list is respected ("no channels").
    channels:
      values[SETTING_KEYS.channels] === undefined || values[SETTING_KEYS.channels] === null
        ? DEFAULT_ALERT_SETTINGS.channels
        : channels,
    backgroundRefreshMinutes: minutes ?? DEFAULT_ALERT_SETTINGS.backgroundRefreshMinutes,
  };
}

export function settingsToRows(settings: AlertSettings): Array<{ key: string; value: string }> {
  return [
    { key: SETTING_KEYS.enabled, value: settings.enabled ? "true" : "false" },
    { key: SETTING_KEYS.thresholdPct, value: String(settings.thresholdPct) },
    { key: SETTING_KEYS.channels, value: settings.channels.join(",") },
    { key: SETTING_KEYS.backgroundRefreshMinutes, value: String(settings.backgroundRefreshMinutes) },
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
 * One alert per asset, per direction, per day, per 5-point severity bucket, so a
 * 15 % crash still alerts after a 6 % dip but a flat market does not repeat.
 */
export function priceAlertKey(move: PriceMove, date: string): string {
  const severity = Math.max(1, Math.floor(Math.abs(move.changePct) * 100 / 5));
  return `price:${move.assetId}:${date}:${move.direction}:${severity}`;
}

export function refreshFailureKey(date: string): string {
  return `refresh-failure:${date}`;
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
  const sign = changePct > 0 ? "+" : "-";
  return `${sign}${Math.abs(changePct * 100).toFixed(2)}%`;
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
    body: `No live crypto price could be fetched for ${attempted} asset${attempted === 1 ? "" : "s"} on ${date}. Prices were left unchanged and will be retried on the next refresh.`,
  };
}

/** Plain-text message used for Telegram (no parse_mode, so nothing to escape). */
export function formatAlertText(alert: { title: string; body: string }): string {
  return `${alert.title}\n${alert.body}`;
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
