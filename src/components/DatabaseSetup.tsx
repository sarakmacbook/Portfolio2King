export default function DatabaseSetup() {
  return (
    <section className="card mx-auto max-w-2xl space-y-5 p-8">
      <div>
        <p className="text-sm font-medium text-indigo-600">One more setup step</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Connect your portfolio database</h1>
        <p className="mt-3 text-slate-600">
          Ledgerly is deployed, but no database connection is configured yet.
          Your holdings and transactions need PostgreSQL to be saved safely.
        </p>
      </div>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-600">
        <li>In your Vercel project, open Storage and connect a Neon Postgres database, or use an existing hosted PostgreSQL database.</li>
        <li>Under Settings → Environment Variables, add <code>DATABASE_URL</code> with your provider’s pooled connection string. <code>POSTGRES_URL</code> is also supported. Select Production and, if needed, Preview.</li>
        <li>Redeploy the project so the new environment variable takes effect.</li>
        <li>Visit <a href="/api/health" className="font-medium text-indigo-600 underline">/api/health</a> to check the connection, then return to your dashboard.</li>
      </ol>
      <p className="text-xs text-slate-500">Keep connection strings private. Never commit them to Git or paste them into chat.</p>
    </section>
  );
}
