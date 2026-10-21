import { isDatabaseConfigured } from "@/db";
import { db } from "@/db";
import { assets, snapshots } from "@/db/schema";
import { rejectUnauthorizedDatabaseRequest } from "@/lib/database-admin";
import { ensureSchema } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CONFIRMATION = "DELETE ALL MY DATA";

export async function DELETE(request: Request) {
  const rejected = rejectUnauthorizedDatabaseRequest(request);
  if (rejected) return rejected;
  if (!isDatabaseConfigured()) {
    return Response.json({ error: "No database is connected." }, { status: 503 });
  }

  let body: { confirmation?: unknown; backupAcknowledged?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (body.backupAcknowledged !== true || body.confirmation !== CONFIRMATION) {
    return Response.json(
      { error: `Deletion blocked. Confirm the backup warning and type ${CONFIRMATION} exactly.` },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await ensureSchema();
    await db.transaction(async (tx) => {
      // Transactions are removed by the assets table's ON DELETE CASCADE.
      await tx.delete(snapshots);
      await tx.delete(assets);
    });
    return Response.json(
      { ok: true, message: "All portfolio assets, transactions, and history snapshots were permanently deleted." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "The database could not be cleared. No partial deletion was committed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
