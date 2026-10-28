import { sameOrigin } from "@/lib/database-admin";
import {
  PRIVACY_COOKIE_NAME,
  PRIVACY_DEVICE_MAX_AGE,
  PRIVACY_HIDDEN_COOKIE_NAME,
  createPasskeyChallenge,
  createPasskeyOnlyPrivacyConfig,
  createPrivacyConfig,
  createSessionToken,
  hasAnyLockConfigured,
  hasPasskeyConfigured,
  hasPinConfigured,
  validatePin,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
  verifyPin,
} from "@/lib/privacy";
import {
  clearPrivacyConfig,
  evaluateRequestPrivacyStatus,
  loadPrivacyConfig,
  savePrivacyConfig,
} from "@/lib/privacy-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 60_000;
const FALLBACK_REGISTRATION_SECRET = "ledgerly-passkey-registration-bootstrap-secret-v1";
let failedAttempts: number[] = [];

function isRateLimited(now = Date.now()): boolean {
  failedAttempts = failedAttempts.filter((ts) => now - ts < LOCKOUT_WINDOW_MS);
  return failedAttempts.length >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(now = Date.now()): void {
  failedAttempts.push(now);
}

function clearFailedAttempts(): void {
  failedAttempts = [];
}

export function resetPrivacyRateLimitForTests(): void {
  failedAttempts = [];
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function formatCookie(
  name: string,
  value: string,
  opts: { maxAge: number; httpOnly?: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function buildPrivacyResponse(
  body: Record<string, unknown>,
  cookiesToSet: string[],
  status = 200,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const cookie of cookiesToSet) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function GET(request: Request): Promise<Response> {
  const config = await loadPrivacyConfig();
  const sessionToken = readCookie(request, PRIVACY_COOKIE_NAME);
  const hiddenCookie = readCookie(request, PRIVACY_HIDDEN_COOKIE_NAME);
  const status = evaluateRequestPrivacyStatus(config, sessionToken, hiddenCookie);
  return buildPrivacyResponse({ ok: true, ...status }, []);
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return buildPrivacyResponse(
      { error: "Privacy requests must come from this app." },
      [],
      403,
    );
  }

  let body: {
    action?: unknown;
    pin?: unknown;
    currentPin?: unknown;
    lockNow?: unknown;
    keepHidden?: unknown;
    credentialId?: unknown;
    clientDataJSON?: unknown;
    publicKeySpki?: unknown;
    authenticatorData?: unknown;
    signature?: unknown;
    alg?: unknown;
    label?: unknown;
    challengeToken?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return buildPrivacyResponse({ error: "Invalid request." }, [], 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const existingConfig = await loadPrivacyConfig();
  const sessionToken = readCookie(request, PRIVACY_COOKIE_NAME);
  const hiddenCookie = readCookie(request, PRIVACY_HIDDEN_COOKIE_NAME);
  const currentStatus = evaluateRequestPrivacyStatus(
    existingConfig,
    sessionToken,
    hiddenCookie,
  );

  if (action === "hide") {
    return buildPrivacyResponse(
      {
        ok: true,
        ...currentStatus,
        hidden: true,
      },
      [formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 })],
    );
  }

  if (action === "lock") {
    if (!existingConfig || !hasAnyLockConfigured(existingConfig)) {
      return buildPrivacyResponse(
        { error: "Set a PIN or Face ID / Passkey first to lock your portfolio." },
        [],
        400,
      );
    }
    return buildPrivacyResponse(
      {
        ok: true,
        ...currentStatus,
        locked: true,
        hidden: true,
      },
      [
        formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
        formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 }),
      ],
    );
  }

  if (action === "forgetDevice") {
    // Drops this browser's remembered unlock so the next visit is treated as a
    // new device and has to pass Face ID / Passkey (or the PIN) again.
    if (!existingConfig || !hasAnyLockConfigured(existingConfig)) {
      return buildPrivacyResponse(
        {
          ok: true,
          hasPin: false,
          hasPasskey: false,
          passkeys: [],
          locked: false,
          hidden: false,
          remembered: false,
        },
        [
          formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 }),
        ],
      );
    }
    return buildPrivacyResponse(
      {
        ok: true,
        ...currentStatus,
        locked: true,
        hidden: true,
        remembered: false,
        message: "This device is forgotten. Unlock with Face ID next time.",
      },
      [
        formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
        formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 }),
      ],
    );
  }

  if (action === "passkeyRegisterOptions") {
    if (existingConfig && currentStatus.locked) {
      if (!hasPinConfigured(existingConfig) || !verifyPin(body.currentPin, existingConfig)) {
        return buildPrivacyResponse(
          { error: "Unlock your portfolio or enter your current PIN before adding a passkey." },
          [],
          401,
        );
      }
    }
    const secret = existingConfig?.sessionSecret ?? FALLBACK_REGISTRATION_SECRET;
    const { challenge, challengeToken } = createPasskeyChallenge(secret);
    return buildPrivacyResponse(
      {
        ok: true,
        challenge,
        challengeToken,
        rpName: "Portfolio",
        user: {
          id: Buffer.from("ledgerly-portfolio-owner").toString("base64url"),
          name: "owner@ledgerly",
          displayName: "Portfolio Owner",
        },
      },
      [],
    );
  }

  if (action === "passkeyRegister") {
    if (existingConfig && currentStatus.locked) {
      if (!hasPinConfigured(existingConfig) || !verifyPin(body.currentPin, existingConfig)) {
        return buildPrivacyResponse(
          { error: "Unlock your portfolio or enter your current PIN before adding a passkey." },
          [],
          401,
        );
      }
    }
    const secret = existingConfig?.sessionSecret ?? FALLBACK_REGISTRATION_SECRET;
    let credential;
    try {
      credential = verifyPasskeyRegistration({
        credentialId: body.credentialId,
        clientDataJSON: body.clientDataJSON,
        publicKeySpki: body.publicKeySpki,
        authenticatorData: body.authenticatorData,
        alg: body.alg,
        label: body.label,
        challengeToken: body.challengeToken,
        secret,
      });
    } catch (error) {
      return buildPrivacyResponse(
        { error: error instanceof Error ? error.message : "Could not register passkey." },
        [],
        400,
      );
    }

    const baseConfig = existingConfig ?? createPasskeyOnlyPrivacyConfig();
    const existingList = (baseConfig.passkeys ?? []).filter((pk) => pk.id !== credential.id);
    const updatedConfig = {
      ...baseConfig,
      passkeys: [...existingList, credential],
      updatedAt: new Date().toISOString(),
    };
    await savePrivacyConfig(updatedConfig);

    const lockNow = body.lockNow === true;
    const token = createSessionToken(updatedConfig);
    const nextStatus = evaluateRequestPrivacyStatus(
      updatedConfig,
      lockNow ? null : token,
      lockNow ? "1" : hiddenCookie,
    );

    return buildPrivacyResponse(
      {
        ok: true,
        ...nextStatus,
        message: "Face ID / Passkey enabled.",
      },
      lockNow
        ? [
            formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
            formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 }),
          ]
        : [
            formatCookie(PRIVACY_COOKIE_NAME, token, {
              maxAge: PRIVACY_DEVICE_MAX_AGE,
              httpOnly: true,
            }),
          ],
    );
  }

  if (action === "passkeyAuthOptions") {
    if (!existingConfig || !hasPasskeyConfigured(existingConfig)) {
      return buildPrivacyResponse(
        { error: "No Face ID or Passkey is registered yet." },
        [],
        400,
      );
    }
    const { challenge, challengeToken } = createPasskeyChallenge(existingConfig.sessionSecret);
    return buildPrivacyResponse(
      {
        ok: true,
        challenge,
        challengeToken,
        credentialIds: (existingConfig.passkeys ?? []).map((pk) => pk.id),
      },
      [],
    );
  }

  if (action === "unlockPasskey" || action === "revealPasskey") {
    if (!existingConfig || !hasPasskeyConfigured(existingConfig)) {
      return buildPrivacyResponse(
        { error: "No Face ID or Passkey is registered." },
        [],
        400,
      );
    }
    if (isRateLimited()) {
      return buildPrivacyResponse(
        { error: "Too many failed attempts. Please wait a minute and try again." },
        [],
        429,
      );
    }
    const valid = verifyPasskeyAssertion({
      credentialId: body.credentialId,
      clientDataJSON: body.clientDataJSON,
      authenticatorData: body.authenticatorData,
      signature: body.signature,
      challengeToken: body.challengeToken,
      config: existingConfig,
    });
    if (!valid) {
      recordFailedAttempt();
      return buildPrivacyResponse(
        { error: "Face ID / Passkey verification failed. Please try again." },
        [],
        401,
      );
    }
    clearFailedAttempts();
    const token = createSessionToken(existingConfig);
    const keepHidden = action === "unlockPasskey" && body.keepHidden === true;
    const nextStatus = evaluateRequestPrivacyStatus(
      existingConfig,
      token,
      keepHidden ? "1" : "",
    );
    return buildPrivacyResponse(
      { ok: true, ...nextStatus, remembered: true },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: PRIVACY_DEVICE_MAX_AGE,
          httpOnly: true,
        }),
        formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, keepHidden ? "1" : "", {
          maxAge: keepHidden ? 60 * 60 * 24 * 365 : 0,
        }),
      ],
    );
  }

  if (action === "removePasskey") {
    if (!existingConfig) {
      return buildPrivacyResponse(
        { ok: true, hasPin: false, hasPasskey: false, passkeys: [], locked: false, hidden: false },
        [],
      );
    }
    if (currentStatus.locked) {
      if (!hasPinConfigured(existingConfig) || !verifyPin(body.currentPin, existingConfig)) {
        return buildPrivacyResponse(
          { error: "Unlock your portfolio or enter your current PIN to remove a passkey." },
          [],
          401,
        );
      }
    }
    const targetId = typeof body.credentialId === "string" ? body.credentialId.trim() : "";
    const remaining = targetId
      ? (existingConfig.passkeys ?? []).filter((pk) => pk.id !== targetId)
      : [];
    const updatedConfig = {
      ...existingConfig,
      passkeys: remaining,
      updatedAt: new Date().toISOString(),
    };
    if (!hasAnyLockConfigured(updatedConfig)) {
      await clearPrivacyConfig();
      return buildPrivacyResponse(
        {
          ok: true,
          hasPin: false,
          hasPasskey: false,
          passkeys: [],
          locked: false,
          hidden: false,
          message: "Face ID / Passkey removed.",
        },
        [
          formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 }),
        ],
      );
    }
    await savePrivacyConfig(updatedConfig);
    const token = createSessionToken(updatedConfig);
    const nextStatus = evaluateRequestPrivacyStatus(updatedConfig, token, hiddenCookie);
    return buildPrivacyResponse(
      {
        ok: true,
        ...nextStatus,
        message: "Face ID / Passkey removed.",
      },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: PRIVACY_DEVICE_MAX_AGE,
          httpOnly: true,
        }),
      ],
    );
  }

  if (action === "reveal") {
    if (existingConfig && hasAnyLockConfigured(existingConfig)) {
      if (isRateLimited()) {
        return buildPrivacyResponse(
          { error: "Too many incorrect PIN attempts. Please wait a minute and try again." },
          [],
          429,
        );
      }
      if (!verifyPin(body.pin, existingConfig)) {
        recordFailedAttempt();
        return buildPrivacyResponse(
          { error: "Enter your PIN or use Face ID / Passkey to reveal hidden balances." },
          [],
          401,
        );
      }
      clearFailedAttempts();
      const token = createSessionToken(existingConfig);
      const nextStatus = evaluateRequestPrivacyStatus(existingConfig, token, "");
      return buildPrivacyResponse(
        { ok: true, ...nextStatus },
        [
          formatCookie(PRIVACY_COOKIE_NAME, token, {
            maxAge: PRIVACY_DEVICE_MAX_AGE,
            httpOnly: true,
          }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 }),
        ],
      );
    }
    return buildPrivacyResponse(
      { ok: true, hasPin: false, hasPasskey: false, passkeys: [], locked: false, hidden: false },
      [formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 })],
    );
  }

  if (action === "unlock") {
    if (!existingConfig || !hasAnyLockConfigured(existingConfig)) {
      return buildPrivacyResponse(
        { ok: true, hasPin: false, hasPasskey: false, passkeys: [], locked: false, hidden: false },
        [formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 })],
      );
    }
    if (isRateLimited()) {
      return buildPrivacyResponse(
        { error: "Too many incorrect PIN attempts. Please wait a minute and try again." },
        [],
        429,
      );
    }
    if (!verifyPin(body.pin, existingConfig)) {
      recordFailedAttempt();
      return buildPrivacyResponse(
        { error: "Incorrect PIN or passcode. Please try again." },
        [],
        401,
      );
    }
    clearFailedAttempts();
    const token = createSessionToken(existingConfig);
    const keepHidden = body.keepHidden === true;
    const nextStatus = evaluateRequestPrivacyStatus(
      existingConfig,
      token,
      keepHidden ? "1" : "",
    );
    return buildPrivacyResponse(
      { ok: true, ...nextStatus, remembered: true },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: PRIVACY_DEVICE_MAX_AGE,
          httpOnly: true,
        }),
        formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, keepHidden ? "1" : "", {
          maxAge: keepHidden ? 60 * 60 * 24 * 365 : 0,
        }),
      ],
    );
  }

  if (action === "setPin") {
    if (existingConfig && hasPinConfigured(existingConfig)) {
      if (isRateLimited()) {
        return buildPrivacyResponse(
          { error: "Too many incorrect PIN attempts. Please wait a minute and try again." },
          [],
          429,
        );
      }
      if (!verifyPin(body.currentPin, existingConfig)) {
        recordFailedAttempt();
        return buildPrivacyResponse(
          { error: "Current PIN or passcode is incorrect." },
          [],
          401,
        );
      }
      clearFailedAttempts();
    }

    let validPin: string;
    try {
      validPin = validatePin(body.pin);
    } catch (error) {
      return buildPrivacyResponse(
        { error: error instanceof Error ? error.message : "Invalid PIN." },
        [],
        400,
      );
    }

    const newConfig = createPrivacyConfig(validPin, new Date(), existingConfig);
    await savePrivacyConfig(newConfig);

    const lockNow = body.lockNow === true;
    const token = createSessionToken(newConfig);
    const nextStatus = evaluateRequestPrivacyStatus(
      newConfig,
      lockNow ? null : token,
      lockNow ? "1" : hiddenCookie,
    );

    if (lockNow) {
      return buildPrivacyResponse(
        {
          ok: true,
          ...nextStatus,
          message: "PIN saved and portfolio locked.",
        },
        [
          formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 }),
        ],
      );
    }

    return buildPrivacyResponse(
      {
        ok: true,
        ...nextStatus,
        message: "PIN saved. You can lock your portfolio anytime from the top bar.",
      },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: PRIVACY_DEVICE_MAX_AGE,
          httpOnly: true,
        }),
      ],
    );
  }

  if (action === "removePin") {
    if (!existingConfig) {
      return buildPrivacyResponse(
        { ok: true, hasPin: false, hasPasskey: false, passkeys: [], locked: false, hidden: false },
        [],
      );
    }
    if (hasPinConfigured(existingConfig)) {
      if (isRateLimited()) {
        return buildPrivacyResponse(
          { error: "Too many incorrect PIN attempts. Please wait a minute and try again." },
          [],
          429,
        );
      }
      if (!verifyPin(body.currentPin, existingConfig)) {
        recordFailedAttempt();
        return buildPrivacyResponse(
          { error: "Current PIN or passcode is incorrect." },
          [],
          401,
        );
      }
      clearFailedAttempts();
    }
    const updatedConfig = {
      ...existingConfig,
      pinEnabled: false,
      updatedAt: new Date().toISOString(),
    };
    if (!hasAnyLockConfigured(updatedConfig)) {
      await clearPrivacyConfig();
      return buildPrivacyResponse(
        {
          ok: true,
          hasPin: false,
          hasPasskey: false,
          passkeys: [],
          locked: false,
          hidden: false,
          message: "PIN lock removed.",
        },
        [
          formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 }),
        ],
      );
    }
    await savePrivacyConfig(updatedConfig);
    const token = createSessionToken(updatedConfig);
    const nextStatus = evaluateRequestPrivacyStatus(updatedConfig, token, hiddenCookie);
    return buildPrivacyResponse(
      {
        ok: true,
        ...nextStatus,
        message: "PIN removed. Face ID / Passkey lock remains active.",
      },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: PRIVACY_DEVICE_MAX_AGE,
          httpOnly: true,
        }),
      ],
    );
  }

  return buildPrivacyResponse({ error: "Unknown privacy action." }, [], 400);
}
