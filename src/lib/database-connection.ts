import type { PoolConfig } from "pg";

export function validateDatabaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || /[\r\n\0]/.test(value)) {
    throw new Error("Enter a valid PostgreSQL connection string.");
  }
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error("Enter a valid PostgreSQL connection string."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.pathname.length < 2 || parsed.hash) {
    throw new Error("Use postgresql://user:password@host:5432/database.");
  }
  try {
    decodeURIComponent(parsed.username);
    decodeURIComponent(parsed.password);
    decodeURIComponent(parsed.pathname);
  } catch { throw new Error("Invalid URL encoding. Percent-encode special characters in your credentials."); }
  // Restrict URL options: pg can read local certificate files through SSL parameters.
  for (const key of parsed.searchParams.keys()) {
    if (!["sslmode", "application_name", "options", "channel_binding"].includes(key)) {
      throw new Error("Unsupported connection option. Use a standard provider connection string without certificate file parameters.");
    }
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode && !["disable", "require", "verify-ca", "verify-full", "prefer"].includes(sslmode)) {
    throw new Error("Unsupported sslmode.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!local && sslmode === "disable") throw new Error("Remote database connections must use TLS.");
  if (process.env.VERCEL && local) throw new Error("Vercel cannot connect to a database on localhost. Use a hosted PostgreSQL server.");
  return parsed.toString();
}

export function connectionConfig(connectionString: string): PoolConfig {
  const parsed = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  // Strip SSL URL options so pg cannot override certificate verification.
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  return {
    connectionString: parsed.toString(),
    ssl: local ? undefined : { rejectUnauthorized: true },
    connectionTimeoutMillis: 8000,
    query_timeout: 8000,
    statement_timeout: 8000,
  };
}
