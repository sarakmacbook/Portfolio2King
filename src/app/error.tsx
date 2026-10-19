"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="card mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">We couldn’t load your portfolio</h1>
      <p className="text-slate-600">
        A server error interrupted this request. If you just deployed, check that
        DATABASE_URL points to a reachable hosted PostgreSQL database, then redeploy
        after changing environment variables. The database user also needs permission
        to create the portfolio tables on first use.
      </p>
      <p className="text-sm text-slate-500">
        Check /api/health for database connectivity and Vercel runtime logs for details.
        No portfolio data is displayed while this request is failing.
      </p>
      <button className="btn-primary" onClick={reset}>Try again</button>
    </section>
  );
}
