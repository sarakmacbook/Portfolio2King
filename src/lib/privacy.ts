import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";

export const PRIVACY_SETTING_KEY = "privacy.lock";
export const PRIVACY_COOKIE_NAME = "ledgerly_privacy_session";
export const PRIVACY_HIDDEN_COOKIE_NAME = "ledgerly_privacy_hidden";
export const PRIVACY_STORAGE_KEY = "ledgerly-privacy-hidden";
export const MASKED_VALUE = "••••••";

export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 32;

const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d03010703420004",
  "hex",
);

export type StoredPasskeyCredential = {
  id: string;
  publicKeySpki: string;
  alg: number;
  label: string;
  createdAt: string;
};

export type StoredPrivacyConfig = {
  salt: string;
  hash: string;
  pinEnabled?: boolean;
  passkeys?: StoredPasskeyCredential[];
  sessionSecret: string;
  updatedAt: string;
};

export function hasPinConfigured(config: StoredPrivacyConfig | null | undefined): boolean {
  if (!config) return false;
  return config.pinEnabled !== false && /^[0-9a-f]{64}$/i.test(config.hash);
}

export function hasPasskeyConfigured(config: StoredPrivacyConfig | null | undefined): boolean {
  return Boolean(config?.passkeys && config.passkeys.length > 0);
}

export function hasAnyLockConfigured(config: StoredPrivacyConfig | null | undefined): boolean {
  return hasPinConfigured(config) || hasPasskeyConfigured(config);
}

export function validatePin(raw: unknown): string {
  const pin = typeof raw === "string" ? raw.trim() : "";
  if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
    throw new Error(`PIN or passcode must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters.`);
  }
  return pin;
}

export function createPrivacyConfig(
  rawPin: string,
  now: Date = new Date(),
  existing?: StoredPrivacyConfig | null,
): StoredPrivacyConfig {
  const pin = validatePin(rawPin);
  const salt = randomBytes(16).toString("hex");
  const sessionSecret = existing?.sessionSecret || randomBytes(32).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return {
    salt,
    hash,
    pinEnabled: true,
    passkeys: existing?.passkeys ?? [],
    sessionSecret,
    updatedAt: now.toISOString(),
  };
}

export function createPasskeyOnlyPrivacyConfig(now: Date = new Date()): StoredPrivacyConfig {
  const salt = randomBytes(16).toString("hex");
  const sessionSecret = randomBytes(32).toString("hex");
  const hash = randomBytes(32).toString("hex");
  return {
    salt,
    hash,
    pinEnabled: false,
    passkeys: [],
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
    const passkeys: StoredPasskeyCredential[] = Array.isArray(parsed.passkeys)
      ? parsed.passkeys
          .filter(
            (pk): pk is StoredPasskeyCredential =>
              typeof pk === "object" &&
              pk !== null &&
              typeof pk.id === "string" &&
              pk.id.length > 0 &&
              typeof pk.publicKeySpki === "string" &&
              pk.publicKeySpki.length > 0,
          )
          .map((pk) => ({
            id: pk.id,
            publicKeySpki: pk.publicKeySpki,
            alg: typeof pk.alg === "number" ? pk.alg : -7,
            label: typeof pk.label === "string" && pk.label.trim() ? pk.label.trim() : "Face ID / Passkey",
            createdAt: typeof pk.createdAt === "string" ? pk.createdAt : new Date(0).toISOString(),
          }))
      : [];
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      pinEnabled: parsed.pinEnabled !== false,
      passkeys,
      sessionSecret: parsed.sessionSecret,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function verifyPin(rawPin: unknown, config: StoredPrivacyConfig): boolean {
  if (!hasPinConfigured(config)) return false;
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
  const passkeyIds = (config.passkeys ?? []).map((pk) => pk.id).join(",");
  return createHmac("sha256", config.sessionSecret)
    .update(`${config.hash}:${config.pinEnabled !== false}:${passkeyIds}`)
    .digest("hex");
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

const CHALLENGE_TTL_MS = 5 * 60_000;

export function createPasskeyChallenge(
  secret: string,
  now: number = Date.now(),
): { challenge: string; challengeToken: string } {
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = now + CHALLENGE_TTL_MS;
  const sig = createHmac("sha256", secret)
    .update(`${challenge}.${expiresAt}`)
    .digest("base64url");
  return {
    challenge,
    challengeToken: `${challenge}.${expiresAt}.${sig}`,
  };
}

export function verifyPasskeyChallengeToken(
  challengeToken: unknown,
  expectedChallenge: unknown,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (typeof challengeToken !== "string" || typeof expectedChallenge !== "string") {
    return false;
  }
  const parts = challengeToken.split(".");
  if (parts.length !== 3) return false;
  const [challenge, expiresAtRaw, sig] = parts;
  if (!challenge || challenge !== expectedChallenge) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expectedSig = createHmac("sha256", secret)
    .update(`${challenge}.${expiresAtRaw}`)
    .digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extracts a P-256 SPKI DER public key from WebAuthn authenticatorData when a
 * browser does not provide `response.getPublicKey()` directly.
 */
export function extractP256SpkiFromAuthData(
  authDataInput: Buffer | string,
): string | null {
  try {
    const authData =
      typeof authDataInput === "string"
        ? Buffer.from(authDataInput, "base64url")
        : authDataInput;
    if (authData.length < 55) return null;
    const flags = authData[32];
    if ((flags & 0x40) === 0) return null;
    const credIdLen = authData.readUInt16BE(53);
    const coseStart = 55 + credIdLen;
    if (authData.length <= coseStart) return null;
    const cose = authData.subarray(coseStart);
    // In CBOR COSE_Key for P-256: -2 (0x21) -> 0x58 0x20 <32-byte X>, -3 (0x22) -> 0x58 0x20 <32-byte Y>
    const xMarker = Buffer.from([0x21, 0x58, 0x20]);
    const yMarker = Buffer.from([0x22, 0x58, 0x20]);
    const xIdx = cose.indexOf(xMarker);
    const yIdx = cose.indexOf(yMarker);
    if (xIdx < 0 || yIdx < 0) return null;
    const x = cose.subarray(xIdx + 3, xIdx + 35);
    const y = cose.subarray(yIdx + 3, yIdx + 35);
    if (x.length !== 32 || y.length !== 32) return null;
    return Buffer.concat([P256_SPKI_PREFIX, x, y]).toString("base64url");
  } catch {
    return null;
  }
}

export function verifyPasskeyRegistration(params: {
  credentialId: unknown;
  clientDataJSON: unknown;
  publicKeySpki?: unknown;
  authenticatorData?: unknown;
  alg?: unknown;
  label?: unknown;
  challengeToken: unknown;
  secret: string;
  now?: number;
}): StoredPasskeyCredential {
  const credentialId = typeof params.credentialId === "string" ? params.credentialId.trim() : "";
  if (!credentialId || credentialId.length > 512) {
    throw new Error("Invalid passkey credential ID.");
  }
  if (typeof params.clientDataJSON !== "string" || !params.clientDataJSON) {
    throw new Error("Missing WebAuthn client data.");
  }
  let clientData: { type?: unknown; challenge?: unknown };
  try {
    clientData = JSON.parse(
      Buffer.from(params.clientDataJSON, "base64url").toString("utf8"),
    ) as typeof clientData;
  } catch {
    throw new Error("Invalid WebAuthn client data.");
  }
  if (clientData.type !== "webauthn.create") {
    throw new Error("Unexpected WebAuthn registration type.");
  }
  if (
    !verifyPasskeyChallengeToken(
      params.challengeToken,
      clientData.challenge,
      params.secret,
      params.now,
    )
  ) {
    throw new Error("Passkey registration challenge expired or invalid. Please try again.");
  }

  let spkiBase64Url =
    typeof params.publicKeySpki === "string" && params.publicKeySpki.trim()
      ? params.publicKeySpki.trim()
      : null;
  if (!spkiBase64Url && typeof params.authenticatorData === "string" && params.authenticatorData) {
    spkiBase64Url = extractP256SpkiFromAuthData(
      Buffer.from(params.authenticatorData, "base64url"),
    );
  }
  if (!spkiBase64Url) {
    throw new Error("Could not read passkey public key from device.");
  }

  try {
    const keyObj = createPublicKey({
      key: Buffer.from(spkiBase64Url, "base64url"),
      format: "der",
      type: "spki",
    });
    if (!keyObj) throw new Error();
  } catch {
    throw new Error("Unsupported or invalid passkey public key.");
  }

  const alg = typeof params.alg === "number" ? params.alg : -7;
  const label =
    typeof params.label === "string" && params.label.trim()
      ? params.label.trim().slice(0, 60)
      : "Face ID / Passkey";

  return {
    id: credentialId,
    publicKeySpki: spkiBase64Url,
    alg,
    label,
    createdAt: new Date(params.now ?? Date.now()).toISOString(),
  };
}

export function verifyPasskeyAssertion(params: {
  credentialId: unknown;
  clientDataJSON: unknown;
  authenticatorData: unknown;
  signature: unknown;
  challengeToken: unknown;
  config: StoredPrivacyConfig;
  expectedRpId?: string;
  now?: number;
}): boolean {
  try {
    const credentialId = typeof params.credentialId === "string" ? params.credentialId.trim() : "";
    if (!credentialId) return false;
    const passkey = (params.config.passkeys ?? []).find((pk) => pk.id === credentialId);
    if (!passkey) return false;

    if (
      typeof params.clientDataJSON !== "string" ||
      typeof params.authenticatorData !== "string" ||
      typeof params.signature !== "string"
    ) {
      return false;
    }

    const clientDataRaw = Buffer.from(params.clientDataJSON, "base64url");
    const clientData = JSON.parse(clientDataRaw.toString("utf8")) as {
      type?: unknown;
      challenge?: unknown;
    };
    if (clientData.type !== "webauthn.get") return false;
    if (
      !verifyPasskeyChallengeToken(
        params.challengeToken,
        clientData.challenge,
        params.config.sessionSecret,
        params.now,
      )
    ) {
      return false;
    }

    const authData = Buffer.from(params.authenticatorData, "base64url");
    if (authData.length < 37) return false;

    if (params.expectedRpId) {
      const expectedRpHash = createHash("sha256").update(params.expectedRpId).digest();
      const actualRpHash = authData.subarray(0, 32);
      if (!timingSafeEqual(expectedRpHash, actualRpHash)) return false;
    }

    // Bit 0 (0x01) = User Present (UP).
    const flags = authData[32];
    if ((flags & 0x01) === 0) return false;

    const clientDataHash = createHash("sha256").update(clientDataRaw).digest();
    const signedData = Buffer.concat([authData, clientDataHash]);
    const signatureBuf = Buffer.from(params.signature, "base64url");
    const publicKey = createPublicKey({
      key: Buffer.from(passkey.publicKeySpki, "base64url"),
      format: "der",
      type: "spki",
    });

    return cryptoVerify("sha256", signedData, publicKey, signatureBuf);
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
