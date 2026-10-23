import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PRIVACY_SETTING_KEY = "privacy.lock";
export const PRIVACY_COOKIE_NAME = "ledgerly_privacy_session";
export const PRIVACY_HIDDEN_COOKIE_NAME = "ledgerly_privacy_hidden";
export const PRIVACY_STORAGE_KEY = "ledgerly-privacy-hidden";
export const MASKED_VALUE = "••••••";

export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 32;

export type StoredPrivacyConfig = {
  salt: string;
  hash: string;
  sessionSecret: string;
  updatedAt: string;
};

export function validatePin(raw: unknown): string {
  const pin = typeof raw === "string" ? raw.trim() : "";
  if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
    throw new Error(`PIN or passcode must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters.`);
  }
  return pin;
}

export function createPrivacyConfig(rawPin: string, now: Date = new Date()): StoredPrivacyConfig {
  const pin = validatePin(rawPin);
  const salt = randomBytes(16).toString("hex");
  const sessionSecret = randomBytes(32).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return {
    salt,
    hash,
    sessionSecret,
    updatedAt: now.toISOString(),
  };
}

export function parsePrivacyConfig(raw: string | null | undefined): StoredPrivacyConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPrivacyConfig>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.salt !== "string" ||
      !/^[0-9a-f]{32}$/i.test(parsed.salt) ||
      typeof parsed.hash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(parsed.hash) ||
      typeof parsed.sessionSecret !== "string" ||
      parsed.sessionSecret.length < 32
    ) {
      return null;
    }
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      sessionSecret: parsed.sessionSecret,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function verifyPin(rawPin: unknown, config: StoredPrivacyConfig): boolean {
  if (typeof rawPin !== "string") return false;
  const pin = rawPin.trim();
  if (!pin || pin.length > MAX_PIN_LENGTH) return false;
  try {
    const actual = scryptSync(pin, config.salt, 32);
    const expected = Buffer.from(config.hash, "hex");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(config: StoredPrivacyConfig): string {
  return createHmac("sha256", config.sessionSecret).update(config.hash).digest("hex");
}

export function verifySessionToken(
  token: string | null | undefined,
  config: StoredPrivacyConfig,
): boolean {
  if (!token || typeof token !== "string") return false;
  try {
    const expected = Buffer.from(createSessionToken(config), "utf8");
    const supplied = Buffer.from(token.trim(), "utf8");
    if (expected.length !== supplied.length) return false;
    return timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}

const CURRENCY_OR_PCT_RE =
  /(?:[+-]?\$\s*\d[\d,.]*[KMBTkmbt]?|[+-]?\d[\d,]*\.\d+\s*%)/g;

/**
 * Masks sensitive dollar amounts, percentages, and tabular numeric strings
 * with `••••••` while preserving surrounding labels.
 */
export function maskSensitiveText(input: string, forceNumericMask = false): string {
  if (!input || !input.trim()) return input;
  let masked = input.replace(CURRENCY_OR_PCT_RE, MASKED_VALUE);
  if (forceNumericMask && masked === input && /\d/.test(input)) {
    masked = input.replace(/[+-]?\d[\d,.]*(?:\s*[KMBTkmbt%])?/g, MASKED_VALUE);
  }
  return masked;
}

/**
 * Self-contained pre-paint script run in <head> so hidden mode applies before
 * the browser paints any numbers.
 */
export function privacyBootScript(): string {
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(
    PRIVACY_STORAGE_KEY,
  )})==="1"){document.documentElement.classList.add("privacy-hidden")}}catch(e){}})();`;
}
