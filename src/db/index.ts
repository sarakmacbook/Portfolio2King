import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

/**
 * Database client — safe for Vercel (serverless) and local development.
 *
 * - Lazy: the pool is only created on the first query, never at import time,
 *   so `next build` succeeds even before DATABASE_URL is configured.
 * - Accepts DATABASE_URL (Neon / Supabase / generic Postgres) or POSTGRES_URL
 *   (the variable the Vercel Postgres / Neon integration provisions).
 * - On Vercel each function instance keeps at most 1 pooled connection and
 *   remote databases get TLS automatically (local Postgres stays plain).
 *   Point DATABASE_URL at your provider's *pooled* connection string.
 */

type Db = NodePgDatabase<Record<string, never>>;

const globalForDb = globalThis as typeof globalThis & {
  __portfolioPool?: Pool;
  __portfolioDb?: Db;
};

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Locally: copy .env.example to .env.local. " +
        "On Vercel: Project → Settings → Environment Variables → add DATABASE_URL " +
        "(use the pooled connection string from Neon / Vercel Postgres / Supabase).",
    );
  }
  return url;
}

function poolConfig(connectionString: string): PoolConfig {
  let isLocal = false;
  let sslDisabled = false;
  try {
    const parsed = new URL(connectionString);
    isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    sslDisabled = parsed.searchParams.get("sslmode") === "disable";
  } catch {
    // Let pg surface a proper connection-string parse error at query time.
  }

  const onServerless = Boolean(process.env.VERCEL);

  return {
    connectionString,
    // One connection per serverless instance avoids exhausting the database
    // when Vercel scales functions out; locally a small pool is faster.
    max: onServerless ? 1 : 10,
    idleTimeoutMillis: onServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres (Neon, Supabase, Vercel Postgres) requires TLS.
    // `rejectUnauthorized: false` matches their pooler endpoints; the
    // connection is still encrypted.
    ssl: isLocal || sslDisabled ? undefined : { rejectUnauthorized: false },
  };
}

function createDb(): Db {
  const pool =
    globalForDb.__portfolioPool ?? new Pool(poolConfig(resolveDatabaseUrl()));

  // Cache on globalThis so warm serverless invocations / dev HMR reuse the
  // pool instead of leaking a new one per module reload.
  globalForDb.__portfolioPool = pool;
  globalForDb.__portfolioDb ??= drizzle(pool);
  return globalForDb.__portfolioDb;
}

let cached: Db | undefined;

function getDb(): Db {
  cached ??= createDb();
  return cached;
}

/**
 * Lazily-initialized Drizzle client. Property access (db.select, db.execute,
 * db.transaction, …) creates the pool on first use — importing this module
 * has no side effects and never throws.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Underlying pg pool (created lazily, same lifecycle as `db`). */
export function getPool(): Pool {
  getDb();
  return globalForDb.__portfolioPool!;
}
