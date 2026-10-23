import { sameOrigin } from "@/lib/database-admin";
import {
  PRIVACY_COOKIE_NAME,
  PRIVACY_HIDDEN_COOKIE_NAME,
  createPrivacyConfig,
  createSessionToken,
  validatePin,
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
        hasPin: currentStatus.hasPin,
        locked: currentStatus.locked,
        hidden: true,
      },
      [formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 })],
    );
  }

  if (action === "lock") {
    if (!existingConfig) {
      return buildPrivacyResponse(
        { error: "Set a PIN or passcode first to lock your portfolio." },
        [],
        400,
      );
    }
    return buildPrivacyResponse(
      { ok: true, hasPin: true, locked: true, hidden: true },
      [
        formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
        formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 }),
      ],
    );
  }

  if (action === "reveal") {
    if (existingConfig) {
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
          { error: "Enter your PIN to reveal hidden balances." },
          [],
          401,
        );
      }
      clearFailedAttempts();
      const token = createSessionToken(existingConfig);
      return buildPrivacyResponse(
        { ok: true, hasPin: true, locked: false, hidden: false },
        [
          formatCookie(PRIVACY_COOKIE_NAME, token, {
            maxAge: 60 * 60 * 24 * 30,
            httpOnly: true,
          }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 }),
        ],
      );
    }
    return buildPrivacyResponse(
      { ok: true, hasPin: false, locked: false, hidden: false },
      [formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "", { maxAge: 0 })],
    );
  }

  if (action === "unlock") {
    if (!existingConfig) {
      return buildPrivacyResponse(
        { ok: true, hasPin: false, locked: false, hidden: false },
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
    return buildPrivacyResponse(
      { ok: true, hasPin: true, locked: false, hidden: keepHidden },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: 60 * 60 * 24 * 30,
          httpOnly: true,
        }),
        formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, keepHidden ? "1" : "", {
          maxAge: keepHidden ? 60 * 60 * 24 * 365 : 0,
        }),
      ],
    );
  }

  if (action === "setPin") {
    if (existingConfig) {
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

    const newConfig = createPrivacyConfig(validPin);
    await savePrivacyConfig(newConfig);

    const lockNow = body.lockNow === true;
    if (lockNow) {
      return buildPrivacyResponse(
        {
          ok: true,
          hasPin: true,
          locked: true,
          hidden: true,
          message: "PIN saved and portfolio locked.",
        },
        [
          formatCookie(PRIVACY_COOKIE_NAME, "", { maxAge: 0, httpOnly: true }),
          formatCookie(PRIVACY_HIDDEN_COOKIE_NAME, "1", { maxAge: 60 * 60 * 24 * 365 }),
        ],
      );
    }

    const token = createSessionToken(newConfig);
    return buildPrivacyResponse(
      {
        ok: true,
        hasPin: true,
        locked: false,
        hidden: currentStatus.hidden,
        message: "PIN saved. You can lock your portfolio anytime from the top bar.",
      },
      [
        formatCookie(PRIVACY_COOKIE_NAME, token, {
          maxAge: 60 * 60 * 24 * 30,
          httpOnly: true,
        }),
      ],
    );
  }

  if (action === "removePin") {
    if (!existingConfig) {
      return buildPrivacyResponse(
        { ok: true, hasPin: false, locked: false, hidden: false },
        [],
      );
    }
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
    await clearPrivacyConfig();
    return buildPrivacyResponse(
      {
        ok: true,
        hasPin: false,
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

  return buildPrivacyResponse({ error: "Unknown privacy action." }, [], 400);
}
