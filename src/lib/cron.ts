import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shared authentication for scheduled endpoints.
 *
 * When `CRON_SECRET` is set, callers must send `Authorization: Bearer <secret>`.
 * Without it the endpoint stays open (like the rest of this unauthenticated
 * app) and each route applies a short per-instance cooldown.
 */
export function verifyCronRequest(
  request: Request,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Response | null {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return null;

  const expected = Buffer.from(secret);
  const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json(
      { error: "Unauthorized cron request" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}

/** Vercel’s scheduler sends a recognizable user agent. */
export function isVercelCron(request: Request): boolean {
  return (request.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
}

export function noStoreJson(body: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init.headers ?? {}), "Cache-Control": "no-store" },
  });
}
