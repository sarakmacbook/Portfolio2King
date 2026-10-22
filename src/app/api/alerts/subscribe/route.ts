import { isDatabaseConfigured } from "@/db";
import { savePushSubscription } from "@/lib/alerts";
import { parsePushSubscription } from "@/lib/alert-rules";
import { noStoreJson } from "@/lib/cron";
import { rejectCrossOrigin } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/alerts/subscribe — stores a browser PushSubscription. */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return noStoreJson({ error: "Expected JSON." }, { status: 415 });
  }
  if (!isDatabaseConfigured()) {
    return noStoreJson({ error: "Connect a database before enabling alerts." }, { status: 503 });
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return noStoreJson({ error: "Subscription is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return noStoreJson({ error: "Invalid subscription." }, { status: 400 });
  }

  const subscription = parsePushSubscription(body);
  if (!subscription) return noStoreJson({ error: "Invalid push subscription." }, { status: 400 });

  try {
    await savePushSubscription({
      ...subscription,
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return noStoreJson({ ok: true, message: "This browser will receive price alerts." });
  } catch {
    return noStoreJson({ error: "Could not save the subscription." }, { status: 500 });
  }
}
