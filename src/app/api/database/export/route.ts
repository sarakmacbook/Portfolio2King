import { isDatabaseConfigured } from "@/db";
import { adminAuthRequired, rejectUnauthorizedDatabaseRequest } from "@/lib/database-admin";
import { backupFileName } from "@/lib/database-backup";
import { exportBackup } from "@/lib/database-transfer";
import { PRIVACY_COOKIE_NAME } from "@/lib/privacy";
import { evaluateRequestPrivacyStatus, loadPrivacyConfig } from "@/lib/privacy-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** GET /api/database/export — status for the UI (no `download` param). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("download") !== "1") {
    return Response.json(
      { configured: isDatabaseConfigured(), authRequired: adminAuthRequired() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const rejected = rejectUnauthorizedDatabaseRequest(request);
  if (rejected) return rejected;
  const privacyConfig = await loadPrivacyConfig();
  const privacyStatus = evaluateRequestPrivacyStatus(
    privacyConfig,
    readCookie(request, PRIVACY_COOKIE_NAME),
    null,
  );
  if (privacyStatus.locked) {
    return Response.json(
      { error: "Portfolio is locked. Unlock with your PIN before exporting." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isDatabaseConfigured()) {
    return Response.json(
      { error: "No database is connected yet. Connect a database before exporting." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const backup = await exportBackup();
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${backupFileName()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Never reflect provider errors — they can contain connection details.
    return Response.json(
      { error: "Export failed. Check that the database is reachable and try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
