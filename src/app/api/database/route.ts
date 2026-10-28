import { timingSafeEqual } from "node:crypto";
import { readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { getDatabaseUrlVariable, resetDatabaseConnection } from "@/db";
import { sameOrigin } from "@/lib/database-admin";
import { connectionConfig, validateDatabaseUrl } from "@/lib/database-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function canSave() {
  return !process.env.VERCEL && (process.env.NODE_ENV === "development" || process.env.ALLOW_DATABASE_SETUP_WRITE === "true");
}
function enabled() { return (process.env.DATABASE_SETUP_TOKEN?.length ?? 0) >= 32; }

export async function GET() {
  const databaseVariable = getDatabaseUrlVariable();
  return Response.json({ configured: databaseVariable !== null, databaseVariable, setupEnabled: enabled(), canSave: canSave(), vercel: Boolean(process.env.VERCEL) }, { headers: { "Cache-Control": "no-store" } });
}

// Per-instance throttling is defense in depth, not a distributed rate limiter.
let lastAttempt = 0;
let busy = false;

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Database setup requests must come from this app." }, { status: 403 });
  }
  if (!enabled()) return Response.json({ error: "Ask the administrator to set DATABASE_SETUP_TOKEN to a random secret of at least 32 characters, then restart or redeploy." }, { status: 403 });
  const expected = Buffer.from(process.env.DATABASE_SETUP_TOKEN!);
  const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "The administrator setup key is incorrect." }, { status: 401 });
  }
  if (busy || Date.now() - lastAttempt < 2000) return Response.json({ error: "Please wait a moment before trying again." }, { status: 429 });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415 });
  lastAttempt = Date.now();
  busy = true;
  let pool: Pool | undefined;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return Response.json({ error: "Request is too large." }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
    if (!body || !["test", "save"].includes(body.action)) return Response.json({ error: "Choose test or save." }, { status: 400 });
    if (body.action === "save" && !canSave()) return Response.json({ error: "This deployment cannot persist configuration files. Set DATABASE_URL in your hosting dashboard and redeploy." }, { status: 409 });
    let url: string;
    try { url = validateDatabaseUrl(body.connectionString); } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid connection string." }, { status: 400 });
    }
    pool = new Pool({ ...connectionConfig(url), max: 1 });
    pool.on("error", () => { /* Never log connection credentials or provider errors. */ });
    try {
      await pool.query("SELECT 1");
      const result = await pool.query<{ allowed: boolean }>("SELECT has_schema_privilege(current_user, 'public', 'USAGE') AND has_schema_privilege(current_user, 'public', 'CREATE') AS allowed");
      if (!result.rows[0]?.allowed) return Response.json({ error: "Connected, but this database user needs USAGE and CREATE permissions on the public schema to initialize Portfolio." }, { status: 422 });
    } catch {
      return Response.json({ error: "Connection failed. Check the host, database, username, password, network access, and TLS certificate. Use your provider’s pooled PostgreSQL URL for serverless hosting." }, { status: 422 });
    }
    if (body.action === "test") return Response.json({ ok: true, message: "Connection verified. The database user can initialize the portfolio tables. No portfolio data was written." });

    const file = path.join(process.cwd(), ".env.local");
    const temporary = path.join(process.cwd(), `.env.database-setup-${process.pid}.local`);
    try {
      let existing = "";
      try { existing = await readFile(file, "utf8"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // Remove old assignments and append one authoritative, safely quoted value.
      const lines = existing.split("\n").filter((line) => !/^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line));
      // Percent-encode dollars to prevent Next's dotenv expansion of credentials.
      const persisted = url.replace(/\$/g, "%24");
      await writeFile(temporary, `${lines.join("\n").trimEnd()}\nDATABASE_URL=${JSON.stringify(persisted)}\n`, { mode: 0o600 });
      await rename(temporary, file);
      process.env.DATABASE_URL = persisted;
      await resetDatabaseConnection();
    } catch {
      return Response.json({ error: "Connection verified, but configuration could not be saved. Set DATABASE_URL in .env.local manually and restart the app." }, { status: 500 });
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return Response.json({ ok: true, message: "Database connected. Configuration saved on this server. Open the dashboard to initialize your portfolio tables." });
  } finally {
    await pool?.end().catch(() => {});
    busy = false;
  }
}
