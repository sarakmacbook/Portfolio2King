import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges";

/**
 * Exchange API credentials, stored encrypted in `app_settings`.
 *
 * These are read-only keys, but a key is still a key: it must never reach the
 * browser, never appear in a log, and never sit in plain text in the database.
 * Credentials are AES-256-GCM encrypted with a key that lives either in
 * `EXCHANGE_CREDENTIALS_KEY` (recommended) or in `app_settings` when that
 * variable is unset — same pattern as the generated VAPID pair, so the feature
 * works out of the box while still being useless in a copied database dump if
 * the env var is set.
 *
 * The UI only ever sees a mask such as `••••••••7F3A`.
 */

const CREDENTIAL_KEY_SETTING = "exchange.credentials.key";
const CREDENTIAL_PREFIX = "exchange.credentials.";

/** Longest accepted key/secret/passphrase, so a paste cannot bloat the row. */
export const MAX_CREDENTIAL_LENGTH = 256;

export const EXCHANGE_CREDENTIAL_KEYS: Record<ExchangeId, string> = {
  binance: `${CREDENTIAL_PREFIX}binance`,
  okx: `${CREDENTIAL_PREFIX}okx`,
  bybit: `${CREDENTIAL_PREFIX}bybit`,
};

export type ExchangeCredentials = {
  exchange: ExchangeId;
  /** Public-ish identifier sent as a header; still never returned to the client. */
  apiKey: string;
  secret: string;
  /**
   * OKX requires the passphrase created with the key. Empty for Binance/Bybit.
   */
  passphrase: string;
  /**
   * Bybit account type (UNIFIED | SPOT | CONTRACT). Empty = UNIFIED, which is
   * what new Bybit accounts use.
   */
  accountType: string;
  /** When the key was stored, for the "connected … ago" label. */
  savedAt: string;
};

/** What the browser is allowed to know about a stored key. */
export type ExchangeCredentialSummary = {
  exchange: ExchangeId;
  connected: true;
  /** e.g. `••••••••7F3A` — last four characters of the key only. */
  hint: string;
  accountType: string;
  savedAt: string;
};

export class ExchangeCredentialError extends Error {
  readonly code: "missing-secret" | "corrupt" | "invalid";
  constructor(message: string, code: "missing-secret" | "corrupt" | "invalid") {
    super(message);
    this.name = "ExchangeCredentialError";
    this.code = code;
  }
}

/** `abcdef123456` → `••••••••3456`. Never echoes the secret. */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••••${trimmed.slice(-4)}`;
}

export function isExchangeId(value: unknown): value is ExchangeId {
  return typeof value === "string" && (EXCHANGE_IDS as readonly string[]).includes(value);
}

/** Trims, length-checks and normalises one submitted field. */
export function normaliseCredential(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (text.length > MAX_CREDENTIAL_LENGTH) {
    throw new ExchangeCredentialError(`${field} is longer than ${MAX_CREDENTIAL_LENGTH} characters.`, "invalid");
  }
  return text;
}

/**
 * Binance keys are 64 alphanumerics, OKX keys are UUID-ish, Bybit keys are
 * 18–36 alphanumerics. Rather than guess per exchange (they change), only
 * reject values that cannot be a key at all: whitespace inside, or no
 * letters/digits. A wrong-but-plausible key is caught by the live check.
 */
export function looksLikeApiKey(value: string): boolean {
  return value.length >= 8 && /^[A-Za-z0-9._-]+$/.test(value);
}

export function looksLikeApiSecret(value: string): boolean {
  return value.length >= 8 && /^[A-Za-z0-9+/=._-]+$/.test(value);
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

function parseKeyMaterial(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // 32-byte hex, base64 or base64url are all accepted.
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const buffer = Buffer.from(trimmed, "base64");
    if (buffer.length === 32) return buffer;
  } catch {
    // fall through
  }
  // Anything else is hashed to 32 bytes, so an arbitrary passphrase still works.
  return trimmed.length >= 16 ? createHash("sha256").update(trimmed).digest() : null;
}

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/**
 * Encryption key: `EXCHANGE_CREDENTIALS_KEY` when set, otherwise a random key
 * generated once and stored beside the ciphertexts.
 */
export async function getCredentialEncryptionKey(): Promise<{ key: Buffer; source: "env" | "generated" }> {
  await ensureSchema();
  const fromEnv = parseKeyMaterial(process.env.EXCHANGE_CREDENTIALS_KEY ?? "");
  if (fromEnv) return { key: fromEnv, source: "env" };

  const stored = await readSetting(CREDENTIAL_KEY_SETTING);
  const fromDb = stored ? parseKeyMaterial(stored) : null;
  if (fromDb) return { key: fromDb, source: "generated" };

  const generated = randomBytes(32).toString("base64");
  await db
    .insert(appSettings)
    .values({ key: CREDENTIAL_KEY_SETTING, value: generated, updatedAt: new Date() })
    .onConflictDoNothing();
  // Re-read: a concurrent request may have written a different key first.
  const settled = await readSetting(CREDENTIAL_KEY_SETTING);
  const parsed = settled ? parseKeyMaterial(settled) : null;
  if (!parsed) throw new ExchangeCredentialError("Could not initialise the credential store", "corrupt");
  return { key: parsed, source: "generated" };
}

/** `v1.iv.tag.ciphertext`, all base64url. Versioned so the format can evolve. */
export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptJson(blob: string, key: Buffer): unknown {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new ExchangeCredentialError("Stored exchange credentials are unreadable — reconnect the key.", "corrupt");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    // Wrong key or tampered row: say so without leaking anything.
    throw new ExchangeCredentialError("Stored exchange credentials are unreadable — reconnect the key.", "corrupt");
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function parseStoredCredentials(exchange: ExchangeId, value: unknown): ExchangeCredentials | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey : "";
  const secret = typeof record.secret === "string" ? record.secret : "";
  if (!apiKey || !secret) return null;
  return {
    exchange,
    apiKey,
    secret,
    passphrase: typeof record.passphrase === "string" ? record.passphrase : "",
    accountType: typeof record.accountType === "string" ? record.accountType : "",
    savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date(0).toISOString(),
  };
}

/** Stored credentials for one exchange, or null when not connected. */
export async function getExchangeCredentials(exchange: ExchangeId): Promise<ExchangeCredentials | null> {
  await ensureSchema();
  const blob = await readSetting(EXCHANGE_CREDENTIAL_KEYS[exchange]);
  if (!blob) return null;
  const { key } = await getCredentialEncryptionKey();
  return parseStoredCredentials(exchange, decryptJson(blob, key));
}

export async function saveExchangeCredentials(credentials: ExchangeCredentials): Promise<void> {
  await ensureSchema();
  const { key } = await getCredentialEncryptionKey();
  await writeSetting(EXCHANGE_CREDENTIAL_KEYS[credentials.exchange], encryptJson(credentials, key));
}

export async function clearExchangeCredentials(exchange: ExchangeId): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, EXCHANGE_CREDENTIAL_KEYS[exchange]));
}

/**
 * Browser-safe summaries for every exchange — no secrets, only a mask. A row
 * that cannot be decrypted is reported as disconnected rather than crashing the
 * page, so a rotated key does not lock the user out of the UI.
 */
export async function getExchangeCredentialSummaries(): Promise<Record<ExchangeId, ExchangeCredentialSummary | null>> {
  const entries = await Promise.all(
    EXCHANGE_IDS.map(async (exchange) => {
      try {
        const credentials = await getExchangeCredentials(exchange);
        if (!credentials) return [exchange, null] as const;
        return [
          exchange,
          {
            exchange,
            connected: true as const,
            hint: maskApiKey(credentials.apiKey),
            accountType: credentials.accountType,
            savedAt: credentials.savedAt,
          },
        ] as const;
      } catch {
        return [exchange, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<ExchangeId, ExchangeCredentialSummary | null>;
}

/** Constant-time check of the optional administrator key (see database-admin.ts). */
export function adminKeyMatches(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
