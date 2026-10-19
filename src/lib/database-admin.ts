import { timingSafeEqual } from "node:crypto";

/**
 * Shared guard for sensitive database operations (export / import).
 *
 * Ledgerly has no user accounts yet (see README), so — like the rest of the
 * app — these endpoints are open when no administrator key is configured.
 * As soon as `DATABASE_SETUP_TOKEN` (≥ 32 chars, the same key used by the
 * database setup wizard) is set on the server, it becomes required, so a
 * public deployment can lock backup/restore down without new configuration.
 */
export function adminAuthRequired(): boolean {
  return (process.env.DATABASE_SETUP_TOKEN?.length ?? 0) >= 32;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string | undefined;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowedHosts = [request.headers.get("host"), request.headers.get("x-forwarded-host"), new URL(request.url).host].filter(Boolean);
  return allowedHosts.includes(originHost) && request.headers.get("sec-fetch-site") !== "cross-site";
}

/** Returns an error Response when the request must be rejected, else null. */
export function rejectUnauthorizedDatabaseRequest(request: Request): Response | null {
  if (!sameOrigin(request)) {
    return Response.json(
      { error: "Database export/import requests must come from this app." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!adminAuthRequired()) return null;
  const expected = Buffer.from(process.env.DATABASE_SETUP_TOKEN!);
  const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json(
      { error: "The administrator setup key is incorrect or missing." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}
