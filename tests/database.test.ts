import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { connectionConfig, validateDatabaseUrl } from "../src/lib/database-connection";
import { rejectUnauthorizedDatabaseRequest, sameOrigin } from "../src/lib/database-admin";
import { recommendDatabase, type Requirements } from "../src/lib/database-options";
import { GET, POST } from "../src/app/api/database/route";

const base: Requirements = { hosting: "vercel", budget: "free", scale: "personal", features: "portfolio", notes: "" };

test("requirements produce compatible and explainable recommendations", () => {
  assert.equal(recommendDatabase(base).provider, "neon");
  assert.equal(recommendDatabase({ ...base, features: "auth" }).provider, "supabase");
  assert.equal(recommendDatabase({ ...base, hosting: "local" }).provider, "postgres");
  assert.equal(recommendDatabase({ ...base, features: "control" }).provider, "postgres");
  assert.match(recommendDatabase({ ...base, scale: "team" }).reasons.join(" "), /isolation/);
  assert.match(recommendDatabase({ ...base, scale: "large" }).reasons.join(" "), /backups/);
});

test("connection strings are validated without reflecting secrets", () => {
  for (const value of [null, "", "mongodb://secret@host/db", "postgresql://host/", "postgresql://user:secret@host/db\n", "postgresql://user:secret@host/db?sslcert=/etc/private", "postgresql://user:secret@host/db?sslmode=disable"]) {
    assert.throws(() => validateDatabaseUrl(value), (error: Error) => !error.message.includes("secret"));
  }
  assert.equal(validateDatabaseUrl("postgres://user:password@localhost/app"), "postgres://user:password@localhost/app");
  const config = connectionConfig("postgresql://user:password@remote.example/app?sslmode=require");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.ok(!config.connectionString?.includes("sslmode"));
  assert.equal(connectionConfig("postgresql://user:password@localhost/app").ssl, undefined);
});

test("setup endpoint protects secrets and persists only on allowed servers", async (t) => {
  const originalEnv = { ...process.env };
  const cwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "ledgerly-setup-"));
  const token = "test-administrator-key-".repeat(3);
  let now = Date.now();
  t.mock.method(Date, "now", () => { now += 3000; return now; });
  function request(body: unknown, auth = token, origin = "http://app.test") {
    return new Request("http://app.test/api/database", { method: "POST", headers: { origin, "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify(body) });
  }
  const valid = { action: "test", connectionString: "postgresql://user:private$password@remote.example/portfolio?sslmode=require" };
  try {
    delete process.env.DATABASE_SETUP_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.VERCEL;
    assert.equal((await POST(request(valid))).status, 403);
    process.env.DATABASE_SETUP_TOKEN = token;
    assert.equal((await POST(request(valid, "wrong-key"))).status, 401);
    assert.equal((await POST(request(valid, token, "https://evil.test"))).status, 403);
    assert.equal((await POST(request({ ...valid, connectionString: "mysql://user:secret@host/db" }))).status, 400);
    const initialStatus = await (await GET()).json();
    assert.equal(initialStatus.setupEnabled, true);
    assert.equal(initialStatus.configured, false);
    assert.equal(initialStatus.databaseVariable, null);
    assert.ok(!JSON.stringify(initialStatus).includes(token));

    process.env.POSTGRES_URL = "postgresql://demo:canary-secret@db.example/portfolio";
    const postgresStatus = await (await GET()).json();
    assert.equal(postgresStatus.databaseVariable, "POSTGRES_URL");
    assert.ok(!JSON.stringify(postgresStatus).includes("canary-secret"));
    process.env.DATABASE_URL = "postgresql://demo:another-secret@db.example/portfolio";
    const databaseStatus = await (await GET()).json();
    assert.equal(databaseStatus.databaseVariable, "DATABASE_URL", "DATABASE_URL takes precedence when both are set");
    assert.ok(!JSON.stringify(databaseStatus).includes("another-secret"));
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;

    const query = t.mock.method(Pool.prototype, "query", async () => ({ rows: [{ allowed: true }] }));
    t.mock.method(Pool.prototype, "end", async () => {});
    assert.equal((await POST(request(valid))).status, 200);
    assert.equal(process.env.DATABASE_URL, undefined, "testing must not activate the database");
    query.mock.mockImplementation(async () => { throw new Error("provider error with private$password"); });
    const failed = await POST(request(valid));
    assert.equal(failed.status, 422);
    assert.ok(!(await failed.text()).includes("private$password"));
    query.mock.mockImplementation(async () => ({ rows: [{ allowed: false }] }));
    assert.equal((await POST(request(valid))).status, 422);
    query.mock.mockImplementation(async () => ({ rows: [{ allowed: true }] }));

    process.env.VERCEL = "1";
    assert.equal((await POST(request({ ...valid, action: "save" }))).status, 409);
    assert.throws(() => validateDatabaseUrl("postgresql://user:pass@localhost/app"), /Vercel/);
    delete process.env.VERCEL;
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.ALLOW_DATABASE_SETUP_WRITE;
    assert.equal((await POST(request({ ...valid, action: "save" }))).status, 409);
    process.env.ALLOW_DATABASE_SETUP_WRITE = "true";
    process.chdir(directory);
    await writeFile(".env.local", "OTHER_SETTING=keep-me\nDATABASE_URL=postgresql://old/old\n");
    const saved = await POST(request({ ...valid, action: "save" }));
    assert.equal(saved.status, 200);
    const file = await readFile(".env.local", "utf8");
    assert.match(file, /OTHER_SETTING=keep-me/);
    assert.match(file, /private%24password/);
    assert.equal((file.match(/^DATABASE_URL=/gm) ?? []).length, 1);
    assert.equal((await stat(".env.local")).mode & 0o777, 0o600);
    const savedStatus = await (await GET()).json();
    assert.equal(savedStatus.configured, true);
    assert.equal(savedStatus.databaseVariable, "DATABASE_URL");
    assert.ok(!(await saved.text()).includes("private"));
  } finally {
    process.chdir(cwd);
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await rm(directory, { recursive: true, force: true });
  }
});

test("database export/import guard accepts same-origin GETs, proxied hosts, and sandboxed previews while rejecting cross-site calls", async () => {
  const originalToken = process.env.DATABASE_SETUP_TOKEN;
  try {
    delete process.env.DATABASE_SETUP_TOKEN;

    // Browser same-origin GET /api/database/export?download=1 omits Origin.
    assert.equal(
      rejectUnauthorizedDatabaseRequest(
        new Request("http://app.test/api/database/export?download=1", {
          method: "GET",
          headers: { referer: "http://app.test/database", "sec-fetch-site": "same-origin" },
        }),
      ),
      null,
    );
    assert.equal(
      rejectUnauthorizedDatabaseRequest(
        new Request("http://app.test/api/database/export?download=1", { method: "GET" }),
      ),
      null,
    );

    // Sandboxed iframe previews send Origin: "null" with Referer or X-Requested-With.
    assert.equal(
      rejectUnauthorizedDatabaseRequest(
        new Request("http://app.test/api/database/import", {
          method: "POST",
          headers: { origin: "null", referer: "http://app.test/database" },
        }),
      ),
      null,
    );
    assert.equal(
      rejectUnauthorizedDatabaseRequest(
        new Request("http://app.test/api/database/import", {
          method: "POST",
          headers: { origin: "null", "x-requested-with": "XMLHttpRequest" },
        }),
      ),
      null,
    );

    // Comma-separated x-forwarded-host behind reverse proxies.
    assert.equal(
      sameOrigin(
        new Request("http://internal:3000/api/database/import", {
          method: "POST",
          headers: {
            origin: "https://ledgerly.example.com",
            "x-forwarded-host": "ledgerly.example.com, proxy.internal",
          },
        }),
      ),
      true,
    );

    // Cross-site requests are still rejected with 403.
    const crossOrigin = rejectUnauthorizedDatabaseRequest(
      new Request("http://app.test/api/database/import", {
        method: "POST",
        headers: { origin: "https://evil.test", "x-requested-with": "XMLHttpRequest" },
      }),
    );
    assert.equal(crossOrigin?.status, 403);

    const crossSiteFetch = rejectUnauthorizedDatabaseRequest(
      new Request("http://app.test/api/database/export?download=1", {
        method: "GET",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    assert.equal(crossSiteFetch?.status, 403);

    const crossReferer = rejectUnauthorizedDatabaseRequest(
      new Request("http://app.test/api/database/export?download=1", {
        method: "GET",
        headers: { referer: "https://evil.test/attack" },
      }),
    );
    assert.equal(crossReferer?.status, 403);

    const barePost = rejectUnauthorizedDatabaseRequest(
      new Request("http://app.test/api/database/import", { method: "POST" }),
    );
    assert.equal(barePost?.status, 403);
  } finally {
    if (originalToken === undefined) delete process.env.DATABASE_SETUP_TOKEN;
    else process.env.DATABASE_SETUP_TOKEN = originalToken;
  }
});

