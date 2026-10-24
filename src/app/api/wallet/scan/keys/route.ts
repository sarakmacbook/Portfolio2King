import { isDatabaseConfigured } from "@/db";
import { noStoreJson } from "@/lib/cron";
import { getScannerKeyStatuses } from "@/lib/scanner-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/scan/keys — masked status for the three scan sources.
 *
 * The browser is told whether a key is configured, where it came from (the app
 * or the environment) and its last four characters. The key itself is never
 * part of the response; saving and removing happen through the server actions in
 * `scanner-actions`.
 */
export async function GET() {
  try {
    const keys = await getScannerKeyStatuses();
    return noStoreJson({ ok: true, databaseConfigured: isDatabaseConfigured(), keys });
  } catch {
    // A broken settings table must not break the scan dialog: report "no keys".
    return noStoreJson({
      ok: false,
      databaseConfigured: isDatabaseConfigured(),
      keys: [],
      error: "Could not read the saved scanner keys.",
    });
  }
}
