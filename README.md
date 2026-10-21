# Ledgerly — Portfolio Manager

Next.js 16 (App Router) + PostgreSQL (Drizzle ORM) app for tracking cash,
stock and crypto holdings with manual price entry.

## Run locally

```bash
npm install
cp .env.example .env.local   # point DATABASE_URL at your Postgres
npm run db:push              # create the tables
npm run dev                  # http://localhost:3000
```

Check the database connection at `GET /api/health` → `{ "ok": true }`.

## Connect a database from the web UI

Open **Database** in the navigation (or `/database`). If no connection is
configured, the dashboard shows this same wizard.

1. Answer questions about hosting, budget, usage, and desired features. Optional
   notes become a checklist for you to verify with the provider; they are not
   automatically analyzed or sent to any external service.
2. Compare PostgreSQL, MySQL, SQLite, and MongoDB. **Only PostgreSQL is currently
   supported** by Ledgerly’s Drizzle schema. The other types are informational,
   not working database adapters.
3. Choose Neon, Supabase, or an existing PostgreSQL server. Recommendations are
   deterministic guidance, not provisioning or a guarantee about provider prices.
4. Set `DATABASE_SETUP_TOKEN` on the server to a strong random secret of at least
   32 characters, then restart/redeploy. Generate one with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   For local development, put it in `.env.local`; on Vercel, use a private
   environment variable. Never use a `NEXT_PUBLIC_` prefix.
5. Enter that administrator key and the PostgreSQL connection string in the
   connection form. **Test connection** checks connectivity and `USAGE` / `CREATE`
   permissions on the public schema without writing portfolio data. It does not
   verify compatibility of pre-existing tables. Use a dedicated database.
6. In local development, confirm the app-wide change and click **Save & connect**.
   This writes a mode-0600 `.env.local` file atomically, preserves unrelated
   assignments, and updates the running connection. Existing data is not migrated
   or deleted. Open the dashboard to create the tables.

File saving is disabled in production unless a persistent self-hosted server
explicitly sets `ALLOW_DATABASE_SETUP_WRITE=true`. It is **always disabled on
Vercel** because function filesystems are ephemeral. On Vercel, you can test
through the UI, then set the verified URL as `DATABASE_URL` in Project →
Settings → Environment Variables and redeploy. The wizard explains these steps;
it does not claim to save a temporary in-memory connection or provision a service.
Environment-variable configuration without the wizard remains supported.

### Setup security and limitations

- The setup key protects both test and save operations. Keep it private; disable
  web setup by removing it and restarting/redeploying once setup is complete.
- Requests must be same-origin. Testing is administrator-only because it makes
  outbound database connections. Only give the key to trusted administrators.
  Per-instance throttling is not a distributed rate limiter; use hosting-level
  protection for public deployments.
- Connection strings and keys are never returned by the API or saved to browser
  storage. Use HTTPS for hosted deployments. URL visibility is off by default.
- Remote connections verify TLS certificates. Self-signed/private-CA servers need
  a trusted CA configured on the app server (e.g. `NODE_EXTRA_CA_CERTS`), not a
  disabled certificate check. URL certificate-file parameters are rejected.
- Saving switches the database for the entire app. This is not per-user database
  selection, and Ledgerly does not yet implement user authentication/data isolation.
  Restrict access to your deployment before storing sensitive portfolio data.
- Self-hosted file saving applies to one server/process; restart other replicas
  with the same configuration. Prefer centrally managed environment variables
  for replicated production deployments.

## Export & import the database

Open **Database** → **Export & import database** (below the setup wizard):

- **Export database** downloads one portable JSON file
  (`ledgerly-backup-YYYY-MM-DD.json`, format version 1) containing every
  asset, transaction, and snapshot in the currently connected PostgreSQL
  database. It is plain JSON — store it, diff it, or move your portfolio
  between providers (e.g. Neon → Supabase) without depending on `pg_dump`
  or a specific PostgreSQL version.
- **Import database** accepts such a backup (up to 10 MB) in two modes:
  - **Merge** keeps existing data and inserts the backup with fresh asset
    ids (transactions are remapped; snapshots for dates already present
    are overwritten).
  - **Replace** deletes all current data and restores the backup exactly,
    including ids. It requires an explicit confirmation checkbox and a
    final browser confirmation — export a backup first.
- Imports are strictly validated before anything is written: unknown
  formats/versions, duplicate or dangling ids, invalid kinds/dates/numbers,
  and transaction histories that oversell an asset are rejected, and derived
  balances (quantity / average cost / realized PnL) are recomputed from the
  transactions rather than trusted from the file. The whole import runs in
  a single transaction, so a failed import leaves the database unchanged.
- If `DATABASE_SETUP_TOKEN` is set on the server, the same administrator
  key is required for export and import; otherwise (like the rest of this
  unauthenticated app) they are open — restrict access to your deployment
  before storing sensitive data, and treat backup files as sensitive too.

## Deploy on Vercel

The repo is Vercel-ready (`vercel.json`, Node ≥ 20.9 — see `.nvmrc` /
`package.json` engines, functions pinned to `sin1` Singapore).

### 1. Create a hosted Postgres (required)

Vercel functions are serverless and cannot reach `localhost`. Use a managed
Postgres with a **pooled** connection string:

- **Neon** (recommended): [console.neon.tech](https://console.neon.tech) →
  create project → copy the *Pooled connection* string. Or in Vercel:
  your project → **Storage → Create Database → Neon Postgres**, which
  provisions `DATABASE_URL` / `POSTGRES_URL` automatically.
- **Supabase**: Settings → Database → *Connection pooling* string (port 6543).

### 2. Import the repo

[Vercel Dashboard](https://vercel.com/new) → **Import** this GitHub repo.
Framework preset **Next.js** is auto-detected; keep the defaults
(build `next build`, root `./`).

### 3. Set the environment variable

Project → **Settings → Environment Variables** (Production + Preview):

| Name           | Value                                  |
| -------------- | -------------------------------------- |
| `DATABASE_URL` | pooled Postgres connection string (step 1) |

`POSTGRES_URL` is also accepted (the Neon/Vercel integration sets both).
No env vars are needed for the build itself — the app only connects to the
database at request time.

> ⚠️ Never commit a real connection string. `.env*` is git-ignored; only
> `.env.example` (with a placeholder) is tracked.

### 4. Create the tables (once, against the production DB)

```bash
# from your machine, using the same production connection string:
DATABASE_URL="postgresql://…pooled…" npm run db:push
```

Or generate SQL migrations and commit them instead:

```bash
npm run db:generate   # writes ./drizzle/*.sql
npm run db:migrate    # applies them to DATABASE_URL
```

### 5. Deploy

Push to `main` (production) or open a PR (preview deployment — give Preview
its own branch database / `DATABASE_URL`, e.g. a Neon branch, so previews
don't write to production data). Verify after deploy:

```
https://<your-app>.vercel.app/api/health   →  { "ok": true }
```

### Deploy with the CLI instead

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production   # paste the pooled connection string
vercel --prod
```

## Scripts

| Script              | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Dev server                             |
| `npm run build`     | Production build (`next build`)        |
| `npm run start`     | Run the production build               |
| `npm run lint`      | ESLint                                 |
| `npm run typecheck` | `tsc --noEmit`                         |
| `npm test` | Database recommendations, URL validation, protected setup API tests (mocked PostgreSQL), and backup format validation tests |
| `npm run db:push`   | Push schema to `DATABASE_URL`          |
| `npm run db:generate` / `db:migrate` | Generate / apply SQL migrations |
| `npm run db:studio` | Drizzle Studio                         |

## Notes for serverless

- `src/db/index.ts` creates the `pg` pool lazily (first query, not import),
  reuses it across warm invocations via `globalThis`, caps it at 1 connection
  per function instance on Vercel, and enables TLS automatically for remote
  databases with certificate verification. Always use your provider's **pooler** endpoint.
- All pages render dynamically (`force-dynamic`) since holdings change on
  every write.
