import { isDatabaseConfigured } from "@/db";
import { removePushSubscription } from "@/lib/alerts";
import { noStoreJson } from "@/lib/cron";
import { rejectCrossOrigin } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/alerts/unsubscribe — removes one browser PushSubscription. */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return noStoreJson({ error: "Expected JSON." }, { status: 415 });
  }
  if (!isDatabaseConfigured()) {
    return noStoreJson({ error: "Connect a database before managing alerts." }, { status: 503 });
  }

  let endpoint = "";
  try {
    const raw = await request.text();
    if (raw.length > 4096) return noStoreJson({ error: "Request is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  if (!endpoint || endpoint.length > 2048) {
    return noStoreJson({ error: "A subscription endpoint is required." }, { status: 400 });
  }

  try {
    await removePushSubscription(endpoint);
    return noStoreJson({ ok: true, message: "This browser will no longer receive alerts." });
  } catch {
    return noStoreJson({ error: "Could not remove the subscription." }, { status: 500 });
  }
}
