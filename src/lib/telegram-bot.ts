import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import { telegramConfigFromEnv, type TelegramConfig } from "@/lib/alert-rules";

/**
 * Telegram bot credentials.
 *
 * Historically these only lived in the environment (`TELEGRAM_BOT_TOKEN`,
 * `TELEGRAM_CHAT_ID`), which meant restarting the server to change anything.
 * They can now be added from the Alerts page and are stored in `app_settings`:
 * stored settings win, the environment stays supported as a fallback.
 *
 * The token is a secret: it is never sent to the browser. The UI only ever sees
 * a masked hint (see `maskBotToken`).
 */

export const TELEGRAM_TOKEN_SETTING = "telegram.botToken";
export const TELEGRAM_CHAT_SETTING = "telegram.chatId";
export const TELEGRAM_USERNAME_SETTING = "telegram.botUsername";

const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const CHAT_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$/;
const API_BASE = "https://api.telegram.org";
const API_TIMEOUT_MS = 10_000;

export type BotTokenCheck = { ok: true; username: string } | { ok: false; error: string; rejected: boolean };

/** BotFather tokens look like `123456789:AA...` (35+ chars after the colon). */
export function isValidBotToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value.trim());
}

/** Numeric chat ids (users, groups, channels) or `@channelname`. */
export function normaliseChatId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return CHAT_PATTERN.test(trimmed) ? trimmed : null;
}

/** `123456789:AAH...` → `123456789:••••abcd`; safe to render in the UI. */
export function maskBotToken(token: string): string {
  const [id, secret = ""] = token.split(":");
  if (!id || !secret) return "••••";
  return `${id}:••••${secret.slice(-4)}`;
}

/**
 * Finds the chat that most recently messaged the bot, so "Connect" works right
 * after the user sends `/start` — no bot like @userinfobot needed.
 * Accepts the raw `getUpdates` response.
 */
export function chatIdFromUpdates(payload: unknown): { chatId: string; title: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) return null;

  for (let index = result.length - 1; index >= 0; index -= 1) {
    const update = result[index];
    if (typeof update !== "object" || update === null) continue;
    const record = update as Record<string, unknown>;
    const message =
      (record.message as Record<string, unknown> | undefined) ??
      (record.edited_message as Record<string, unknown> | undefined) ??
      (record.channel_post as Record<string, unknown> | undefined) ??
      (record.my_chat_member as Record<string, unknown> | undefined);
    if (!message) continue;
    const chat = message.chat as Record<string, unknown> | undefined;
    if (!chat) continue;
    const id = chat.id;
    if (typeof id !== "number" && typeof id !== "string") continue;
    const chatId = String(id);
    if (!CHAT_PATTERN.test(chatId)) continue;
    const name =
      (typeof chat.title === "string" && chat.title) ||
      (typeof chat.username === "string" && `@${chat.username}`) ||
      (typeof chat.first_name === "string" && chat.first_name) ||
      chatId;
    return { chatId, title: name };
  }
  return null;
}

async function callApi(
  token: string,
  method: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string; rejected: boolean }> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(method === "getUpdates" ? { limit: 25, timeout: 0 } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach api.telegram.org from the server.", rejected: false };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401 || response.status === 404) {
    return { ok: false, error: "Telegram rejected this bot token. Copy it again from @BotFather.", rejected: true };
  }
  if (response.status === 429) {
    return { ok: false, error: "Telegram rate limit reached. Wait a minute and try again.", rejected: true };
  }
  if (!response.ok) {
    return { ok: false, error: `Telegram returned ${response.status}.`, rejected: true };
  }
  if (body && typeof body === "object" && (body as { ok?: unknown }).ok === false) {
    return { ok: false, error: "Telegram rejected the request. Check the bot token.", rejected: true };
  }
  return { ok: true, body };
}

/** Calls `getMe` to confirm the token is a real, live bot. */
export async function verifyBotToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BotTokenCheck> {
  const result = await callApi(token, "getMe", fetchImpl);
  if (!result.ok) return { ok: false, error: result.error, rejected: result.rejected };
  const body = result.body as { result?: { username?: unknown } } | null;
  const username = typeof body?.result?.username === "string" ? body.result.username : "";
  return { ok: true, username };
}

/** Finds the chat to send to by looking at who recently messaged the bot. */
export async function discoverChatId(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ chatId: string; title: string } | { error: string }> {
  const result = await callApi(token, "getUpdates", fetchImpl);
  if (!result.ok) return { error: result.error };
  const found = chatIdFromUpdates(result.body);
  if (!found) {
    return {
      error:
        "No recent chat found. Open Telegram, send /start (or any message) to your bot, then connect again — or paste the chat id.",
    };
  }
  return found;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim());
}

async function readSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings);
  const wanted = new Set(keys);
  const values: Record<string, string> = {};
  for (const row of rows) if (wanted.has(row.key)) values[row.key] = row.value;
  return values;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } });
}

export type TelegramStatus = {
  configured: boolean;
  source: "settings" | "env" | null;
  botUsername?: string;
  chatId?: string;
  tokenHint?: string;
};

/** Safe, browser-facing summary of the Telegram connection. */
export async function getTelegramStatus(): Promise<TelegramStatus> {
  if (!hasDatabase()) {
    const env = telegramConfigFromEnv();
    if (!env) return { configured: false, source: null };
    return { configured: true, source: "env", chatId: env.chatId, tokenHint: maskBotToken(env.token) };
  }

  await ensureSchema();
  const values = await readSettings([TELEGRAM_TOKEN_SETTING, TELEGRAM_CHAT_SETTING, TELEGRAM_USERNAME_SETTING]);
  const token = values[TELEGRAM_TOKEN_SETTING] ?? "";
  const chatId = values[TELEGRAM_CHAT_SETTING] ?? "";
  if (isValidBotToken(token) && normaliseChatId(chatId)) {
    return {
      configured: true,
      source: "settings",
      chatId,
      tokenHint: maskBotToken(token),
      botUsername: values[TELEGRAM_USERNAME_SETTING] || undefined,
    };
  }

  const env = telegramConfigFromEnv();
  if (!env) return { configured: false, source: null };
  return { configured: true, source: "env", chatId: env.chatId, tokenHint: maskBotToken(env.token) };
}

/** Full credentials for sending. Stored settings win over the environment. */
export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  if (hasDatabase()) {
    await ensureSchema();
    const values = await readSettings([TELEGRAM_TOKEN_SETTING, TELEGRAM_CHAT_SETTING]);
    const token = values[TELEGRAM_TOKEN_SETTING] ?? "";
    const chatId = values[TELEGRAM_CHAT_SETTING] ?? "";
    if (isValidBotToken(token) && normaliseChatId(chatId)) return { token, chatId };
  }
  return telegramConfigFromEnv();
}

export async function saveTelegramConfig(config: {
  token: string;
  chatId: string;
  botUsername?: string;
}): Promise<void> {
  await ensureSchema();
  await writeSetting(TELEGRAM_TOKEN_SETTING, config.token);
  await writeSetting(TELEGRAM_CHAT_SETTING, config.chatId);
  await writeSetting(TELEGRAM_USERNAME_SETTING, config.botUsername ?? "");
}

/** Removes the stored bot. Environment credentials (if any) become active again. */
export async function clearTelegramConfig(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, TELEGRAM_TOKEN_SETTING));
  await db.delete(appSettings).where(eq(appSettings.key, TELEGRAM_CHAT_SETTING));
  await db.delete(appSettings).where(eq(appSettings.key, TELEGRAM_USERNAME_SETTING));
}
