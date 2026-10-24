import { eq } from "drizzle-orm";
import { db, isDatabaseConfigured } from "@/db";
import { appSettings } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import {
  decryptJson,
  encryptJson,
  getCredentialEncryptionKey,
} from "@/lib/exchange-credentials";

/**
 * API keys for the wallet scanner.
 *
 * The scan sources all work without a key, but each one reads fewer tokens that
 * way — DeBank refuses its keyless routes, and Moralis / Etherscan (Blockscan)
 * simply require one. Those keys used to exist only as environment variables,
 * which meant editing a deployment to paste a key. They can now be added from
 * the app (the "Scanner API keys" panel in the add-holding dialog) and are
 * stored in `app_settings`, encrypted with the same AES-256-GCM store the
 * exchange keys use — `EXCHANGE_CREDENTIALS_KEY` when it is set, otherwise a key
 * generated once and kept beside the ciphertext.
 *
 * Rules:
 * - A key saved in the app wins over the environment. Removing it falls back to
 *   the variable again, so both ways of configuring the scanner keep working.
 * - The browser only ever sees a mask (`••••••••7F3A`) and whether a key is
 *   configured — never the key itself.
 * - Every read is defensive: a database that is unreachable simply means "no
 *   saved keys", so a scan still runs from the environment.
 */

export type ScannerProvider = "debank" | "etherscan" | "moralis";

export type ScannerKeySpec = {
  /** Stable id used in forms, routes and `app_settings`. */
  id: ScannerProvider;
  label: string;
  /** Environment variables that also provide this key (first one wins). */
  envVars: string[];
  /** `app_settings` row holding the encrypted key. */
  setting: string;
  /** Where a free key is obtained. */
  docsUrl: string;
  /** One line describing what the key unlocks. */
  usedFor: string;
  /** The shape to expect, shown as the input's placeholder. */
  format: string;
};

export const SCANNER_KEY_SPECS: ScannerKeySpec[] = [
  {
    id: "debank",
    label: "DeBank",
    envVars: ["DEBANK_ACCESS_KEY"],
    setting: "scanner.key.debank",
    docsUrl: "https://cloud.debank.com",
    usedFor:
      "The default scan: every EVM chain DeBank indexes, with prices. Without a key DeBank answers an empty list, so the scan falls back to reading chains directly.",
    format: "AccessKey from cloud.debank.com",
  },
  {
    id: "etherscan",
    label: "Etherscan (Blockscan)",
    envVars: ["ETHERSCAN_API_KEY", "BLOCKSCAN_API_KEY"],
    setting: "scanner.key.etherscan",
    docsUrl: "https://etherscan.io/myapikey",
    usedFor:
      "“Scan via Blockscan” — Etherscan V2 reads every chain it supports with one key. A free key reads native balances; token holdings need a paid plan.",
    format: "34-character key from etherscan.io/myapikey",
  },
  {
    id: "moralis",
    label: "Moralis",
    envVars: ["MORALIS_API_KEY", "MORALIS_APIKEY"],
    setting: "scanner.key.moralis",
    docsUrl: "https://admin.moralis.com",
    usedFor:
      "“Scan via Moralis” — the only source that flags a token as `possible_spam` itself, and it is preferred automatically in a default scan once a key is set.",
    format: "Web3 API key from admin.moralis.com",
  },
];

export const SCANNER_PROVIDERS: ScannerProvider[] = SCANNER_KEY_SPECS.map((spec) => spec.id);

/** Long enough for any of these keys, short enough that a paste cannot bloat a row. */
export const MAX_SCANNER_KEY_LENGTH = 256;

/** The shortest key any of the three sources issues (Etherscan's is 34). */
export const MIN_SCANNER_KEY_LENGTH = 8;

export class ScannerKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerKeyError";
  }
}

export function isScannerProvider(value: unknown): value is ScannerProvider {
  return typeof value === "string" && (SCANNER_PROVIDERS as string[]).includes(value);
}

export function scannerKeySpec(provider: ScannerProvider): ScannerKeySpec {
  return SCANNER_KEY_SPECS.find((spec) => spec.id === provider) ?? SCANNER_KEY_SPECS[0];
}

/**
 * Trims a pasted key and rejects what cannot be one.
 *
 * Keys are opaque strings, so this only rules out the mistakes a paste makes:
 * surrounding quotes, whitespace inside, a URL copied instead of the key, or
 * something far too short to be real. A plausible-but-wrong key is caught by
 * the source when the scan runs.
 */
export function normaliseScannerKey(value: unknown): string {
  const raw = String(value ?? "").trim();
  // Smart quotes and stray backticks come along when copying from docs.
  const unquoted = raw.replace(/^[`'"]+|[`'"]+$/g, "").trim();
  if (!unquoted) throw new ScannerKeyError("Paste your API key first.");
  if (unquoted.length < MIN_SCANNER_KEY_LENGTH) {
    throw new ScannerKeyError(
      `That key is too short — scanner keys are at least ${MIN_SCANNER_KEY_LENGTH} characters.`,
    );
  }
  if (unquoted.length > MAX_SCANNER_KEY_LENGTH) {
    throw new ScannerKeyError(
      `That key is longer than ${MAX_SCANNER_KEY_LENGTH} characters — copy it again without surrounding text.`,
    );
  }
  if (/\s/.test(unquoted)) {
    throw new ScannerKeyError("That key has a space in it — check for a partial paste.");
  }
  if (/^https?:\/\//i.test(unquoted)) {
    throw new ScannerKeyError("That looks like a link, not a key — copy the key itself.");
  }
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(unquoted)) {
    throw new ScannerKeyError(
      "That does not look like an API key — it should be letters, digits and - _ . only.",
    );
  }
  return unquoted;
}

/** `abcdef123456` → `••••••••3456`. Never echoes the key. */
export function maskScannerKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••••${trimmed.slice(-4)}`;
}

/** The key from the environment, or "". First matching variable wins. */
export function scannerKeyFromEnv(
  spec: ScannerKeySpec,
  env: Record<string, string | undefined> = process.env,
): string {
  for (const name of spec.envVars) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/** A key as it was stored: the secret plus when it was saved. */
export type StoredScannerKey = { key: string; savedAt: string };

export type ResolvedScannerKey = {
  key: string;
  /** Where the key came from; `none` means the source will run keyless. */
  source: "app" | "env" | "none";
  /** Masked key, safe for the browser. */
  hint: string;
  savedAt: string | null;
};

/**
 * A saved key beats the environment. Pure so the precedence is testable without
 * a database.
 */
export function resolveScannerKey(
  spec: ScannerKeySpec,
  options: {
    stored?: StoredScannerKey | null;
    env?: Record<string, string | undefined>;
  } = {},
): ResolvedScannerKey {
  const stored = options.stored?.key?.trim();
  if (stored) {
    return {
      key: stored,
      source: "app",
      hint: maskScannerKey(stored),
      savedAt: options.stored?.savedAt ?? null,
    };
  }
  const env = scannerKeyFromEnv(spec, options.env);
  if (env) return { key: env, source: "env", hint: maskScannerKey(env), savedAt: null };
  return { key: "", source: "none", hint: "", savedAt: null };
}

/** What the browser is allowed to know about one scanner key. */
export type ScannerKeyStatus = {
  id: ScannerProvider;
  label: string;
  configured: boolean;
  source: "app" | "env" | "none";
  /** `••••••••7F3A`, or "" when nothing is configured. */
  hint: string;
  savedAt: string | null;
  /** True when a key saved in the app can be removed here. */
  removable: boolean;
  /** The environment variable that would also work, for the hint text. */
  envVar: string;
  docsUrl: string;
  usedFor: string;
  format: string;
  /** An app-saved key can only be stored once a database is connected. */
  canSave: boolean;
};

/** Builds the browser-safe status list from stored rows + environment. */
export function buildScannerKeyStatuses(
  stored: Partial<Record<ScannerProvider, StoredScannerKey | null>>,
  options: { env?: Record<string, string | undefined>; canSave?: boolean } = {},
): ScannerKeyStatus[] {
  const env = options.env ?? process.env;
  return SCANNER_KEY_SPECS.map((spec) => {
    const resolved = resolveScannerKey(spec, { stored: stored[spec.id] ?? null, env });
    return {
      id: spec.id,
      label: spec.label,
      configured: resolved.source !== "none",
      source: resolved.source,
      hint: resolved.hint,
      savedAt: resolved.savedAt,
      removable: resolved.source === "app",
      envVar: spec.envVars[0],
      docsUrl: spec.docsUrl,
      usedFor: spec.usedFor,
      format: spec.format,
      canSave: options.canSave ?? true,
    };
  });
}

/** Every key the scanner should use, in the shape `scanWalletAddress` wants. */
export type ScannerKeys = {
  debank: string;
  /** Etherscan V2, the API behind Blockscan. */
  blockscan: string;
  moralis: string;
};

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

function parseStoredKey(value: unknown): StoredScannerKey | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key) return null;
  return {
    key,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date(0).toISOString(),
  };
}

async function readStoredKey(provider: ScannerProvider): Promise<StoredScannerKey | null> {
  const spec = scannerKeySpec(provider);
  const blob = await readSetting(spec.setting);
  if (!blob) return null;
  const { key } = await getCredentialEncryptionKey();
  return parseStoredKey(decryptJson(blob, key));
}

async function readStoredKeys(): Promise<Partial<Record<ScannerProvider, StoredScannerKey | null>>> {
  if (!isDatabaseConfigured()) return {};
  await ensureSchema();
  const entries = await Promise.all(
    SCANNER_KEY_SPECS.map(async (spec) => {
      try {
        return [spec.id, await readStoredKey(spec.id)] as const;
      } catch {
        // Unreadable row (rotated encryption key): treat it as "not saved"
        // rather than breaking the scan.
        return [spec.id, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Partial<Record<ScannerProvider, StoredScannerKey | null>>;
}

/**
 * The keys a scan should use: saved in the app, else the environment. Never
 * throws — a database problem only means the environment is used.
 */
export async function getScannerKeys(): Promise<ScannerKeys> {
  let stored: Partial<Record<ScannerProvider, StoredScannerKey | null>> = {};
  try {
    stored = await readStoredKeys();
  } catch {
    stored = {};
  }
  const keyFor = (provider: ScannerProvider) =>
    resolveScannerKey(scannerKeySpec(provider), { stored: stored[provider] ?? null }).key;
  return {
    debank: keyFor("debank"),
    blockscan: keyFor("etherscan"),
    moralis: keyFor("moralis"),
  };
}

/** Masked status for every scanner key — what the settings panel renders. */
export async function getScannerKeyStatuses(): Promise<ScannerKeyStatus[]> {
  let stored: Partial<Record<ScannerProvider, StoredScannerKey | null>> = {};
  try {
    stored = await readStoredKeys();
  } catch {
    stored = {};
  }
  return buildScannerKeyStatuses(stored, { canSave: isDatabaseConfigured() });
}

/**
 * Saves one key, encrypted. Throws `ScannerKeyError` with a message written for
 * the user when the value cannot be a key.
 */
export async function saveScannerKey(provider: ScannerProvider, raw: unknown): Promise<StoredScannerKey> {
  const spec = scannerKeySpec(provider);
  const key = normaliseScannerKey(raw);
  if (!isDatabaseConfigured()) {
    throw new ScannerKeyError(
      `Connect a database first — a saved ${spec.label} key lives in the app settings table. Until then set ${spec.envVars[0]} in the environment.`,
    );
  }
  await ensureSchema();
  const stored: StoredScannerKey = { key, savedAt: new Date().toISOString() };
  const { key: encryptionKey } = await getCredentialEncryptionKey();
  await writeSetting(spec.setting, encryptJson(stored, encryptionKey));
  return stored;
}

/** Removes a saved key. The environment variable, if any, becomes active again. */
export async function removeScannerKey(provider: ScannerProvider): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, scannerKeySpec(provider).setting));
}
