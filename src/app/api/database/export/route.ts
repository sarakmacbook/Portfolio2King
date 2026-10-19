import { isDatabaseConfigured } from "@/db";
import { adminAuthRequired, rejectUnauthorizedDatabaseRequest } from "@/lib/database-admin";
import { backupFileName } from "@/lib/database-backup";
import { exportBackup } from "@/lib/database-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
