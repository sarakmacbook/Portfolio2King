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

function parseAllowedHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  for (const raw of [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
    new URL(request.url).host,
  ]) {
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return hosts;
}

function hostFromUrlHeader(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function sameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const allowedHosts = parseAllowedHosts(request);

  // When a non-null Origin header is present, it must match this app's host.
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    const originHost = hostFromUrlHeader(origin);
    return originHost !== null && allowedHosts.has(originHost);
  }

  // Browsers omit Origin on same-origin GET requests and set Origin: "null" in
  // sandboxed preview iframes; fall back to Referer, Fetch Metadata, or the
  // custom X-Requested-With header (which cross-origin callers cannot send
  // without a CORS preflight).
  const refererHost = hostFromUrlHeader(request.headers.get("referer"));
  if (refererHost !== null) {
    return allowedHosts.has(refererHost);
  }

  if (fetchSite === "same-origin") {
    return true;
  }

  if (request.headers.get("x-requested-with") === "XMLHttpRequest") {
    return true;
  }

  if (request.method === "GET" && fetchSite !== "same-site") {
    return true;
  }

  return false;
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
