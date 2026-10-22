import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/db";
import { runDailyPriceSnapshot } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUBLIC_COOLDOWN_MS = 60_000;
let lastUnauthenticatedRunAt = 0;

export function verifyCronRequest(request: Request, env: Partial<NodeJS.ProcessEnv> = process.env): Response | null {
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

export async function GET(request: Request) {
  const rejected = verifyCronRequest(request);
  if (rejected) return rejected;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, skipped: "Database not configured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const isVercelCron = (request.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
  const now = Date.now();
  if (!process.env.CRON_SECRET?.trim() && !isVercelCron && now - lastUnauthenticatedRunAt < PUBLIC_COOLDOWN_MS) {
    return NextResponse.json(
      { ok: true, throttled: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  lastUnauthenticatedRunAt = now;

  try {
    const summary = await runDailyPriceSnapshot({ onlyStaleCrypto: false });
    revalidatePath("/", "layout");
    return NextResponse.json(
      { ok: true, ...summary },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to capture daily snapshot" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
