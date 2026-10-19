import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Used by `npm run db:push` / `db:migrate` (run locally or in CI — never at
// request time). Falls back to the local Docker/dev database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
});
