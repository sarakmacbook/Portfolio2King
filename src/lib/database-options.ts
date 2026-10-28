export type Requirements = {
  hosting: "vercel" | "server" | "local";
  budget: "free" | "paid";
  scale: "personal" | "team" | "large";
  features: "portfolio" | "auth" | "control";
  notes: string;
};

export const databaseTypes = [
  { id: "postgres", name: "PostgreSQL", description: "Relational tables, reliable transactions, and financial reporting. Supported by Portfolio.", compatible: true },
  { id: "mysql", name: "MySQL", description: "A relational alternative for transactional apps. Requires a new driver and schema migration in Portfolio.", compatible: false },
  { id: "sqlite", name: "SQLite", description: "A single-file database for local, small apps. Requires an adapter; not suitable for persistent storage on Vercel functions.", compatible: false },
  { id: "mongodb", name: "MongoDB", description: "Document storage for flexible records. Requires redesigning Portfolio’s relational schema and queries.", compatible: false },
] as const;

export const providers = [
  { id: "neon", name: "Neon", detail: "Managed PostgreSQL with pooled connections and database branches.", url: "https://console.neon.tech", instruction: "Create a project, then copy the pooled PostgreSQL connection string from Connection Details." },
  { id: "supabase", name: "Supabase", detail: "Managed PostgreSQL with optional authentication and storage services.", url: "https://supabase.com/dashboard", instruction: "Create a project, open Connect, and copy a transaction pooler connection string. Use the database password, not an API key." },
  { id: "postgres", name: "Existing PostgreSQL", detail: "Use your own PostgreSQL server or another managed provider.", url: "https://www.postgresql.org/docs/current/libpq-connect.html", instruction: "Ask your database administrator for a PostgreSQL URL. The user needs access to the public schema and permission to create Portfolio’s tables." },
] as const;

export function recommendDatabase(r: Requirements) {
  const provider = r.features === "control" || r.hosting === "local" ? "postgres" : r.features === "auth" ? "supabase" : "neon";
  const reasons = ["PostgreSQL matches Portfolio’s relational holdings, transactions, and reporting schema."];
  if (provider === "neon") reasons.push("Neon’s pooled connections fit hosted and serverless deployments.");
  if (provider === "supabase") reasons.push("Supabase fits your interest in authentication or file storage; those features are not automatically enabled in Portfolio.");
  if (provider === "postgres") reasons.push("An existing or self-managed PostgreSQL server fits your local hosting or infrastructure-control preference.");
  if (r.budget === "free") reasons.push("Start with a provider’s free tier where available; verify current quotas, backups, and pricing before creating a project.");
  if (r.scale === "large") reasons.push("For a large deployment, plan connection limits, backups, regional latency, and load testing before production.");
  if (r.scale === "team") reasons.push("For a team, plan backups and access control. This portfolio app does not yet provide per-user data isolation.");
  return { provider, reasons };
}
