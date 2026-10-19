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
| `npm run db:push`   | Push schema to `DATABASE_URL`          |
| `npm run db:generate` / `db:migrate` | Generate / apply SQL migrations |
| `npm run db:studio` | Drizzle Studio                         |

## Notes for serverless

- `src/db/index.ts` creates the `pg` pool lazily (first query, not import),
  reuses it across warm invocations via `globalThis`, caps it at 1 connection
  per function instance on Vercel, and enables TLS automatically for remote
  databases. Always use your provider's **pooler** endpoint.
- All pages render dynamically (`force-dynamic`) since holdings change on
  every write.
