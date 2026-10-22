import { revalidatePath } from "next/cache";
import { isDatabaseConfigured } from "@/db";
import { rejectUnauthorizedDatabaseRequest } from "@/lib/database-admin";
import { BackupValidationError, MAX_BACKUP_BYTES, parseBackup } from "@/lib/database-backup";
import { importBackup, type ImportMode } from "@/lib/database-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/database/import — multipart form: file, mode, confirmReplace. */
export async function POST(request: Request) {
  const rejected = rejectUnauthorizedDatabaseRequest(request);
  if (rejected) return rejected;
  if (!isDatabaseConfigured()) {
    return Response.json(
      { error: "No database is connected yet. Connect a database before importing." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return Response.json({ error: "Expected a multipart form upload." }, { status: 415 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }

  const mode = form.get("mode");
  if (mode !== "replace" && mode !== "merge") {
    return Response.json({ error: "Choose whether the import replaces or merges with existing data." }, { status: 400 });
  }
  if (mode === "replace" && form.get("confirmReplace") !== "true") {
    return Response.json(
      { error: "Replacing the database deletes all current portfolio data. Confirm the replacement to continue." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a Ledgerly backup (.json) file to import." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "The chosen file is empty." }, { status: 400 });
  if (file.size > MAX_BACKUP_BYTES) {
    return Response.json({ error: `Backup file is too large (limit ${Math.floor(MAX_BACKUP_BYTES / 1024 / 1024)} MB).` }, { status: 413 });
  }

  let parsed: ReturnType<typeof parseBackup>;
  try {
    parsed = parseBackup(JSON.parse(await file.text()));
  } catch (error) {
    const message =
      error instanceof BackupValidationError
        ? error.message
        : "The chosen file is not valid JSON. Choose a backup created by Export database.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    const summary = await importBackup(parsed, mode as ImportMode);
    revalidatePath("/", "layout");
    return Response.json({
      ok: true,
      ...summary,
      message:
        mode === "replace"
          ? `Database restored: ${summary.assets} assets, ${summary.transactions} transactions, ${summary.snapshots} portfolio snapshots, ${summary.priceSnapshots} daily price snapshots. Previous data was replaced.`
          : `Import merged: ${summary.assets} assets, ${summary.transactions} transactions, ${summary.snapshots} portfolio snapshots, ${summary.priceSnapshots} daily price snapshots added.`,
    });
  } catch {
    // The import runs in one transaction, so the database is unchanged.
    // Never reflect provider errors — they can contain connection details.
    return Response.json(
      { error: "Import failed and no data was changed. Check that the database is reachable and try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
