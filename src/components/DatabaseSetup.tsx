"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { databaseTypes, providers, recommendDatabase, type Requirements } from "@/lib/database-options";

type Status = { configured: boolean; databaseVariable: "DATABASE_URL" | "POSTGRES_URL" | null; setupEnabled: boolean; canSave: boolean; vercel: boolean };
const steps = ["Your requirements", "Choose a database", "Connect & verify"];

export default function DatabaseSetup() {
  const [step, setStep] = useState(0);
  const [requirements, setRequirements] = useState<Requirements>({ hosting: "vercel", budget: "free", scale: "personal", features: "portfolio", notes: "" });
  const [type, setType] = useState("postgres");
  const [provider, setProvider] = useState("neon");
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const recommendation = recommendDatabase(requirements);
  const selectedProvider = providers.find((p) => p.id === provider)!;

  useEffect(() => {
    fetch("/api/database", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(setStatus).catch(() => setStatusError(true));
  }, []);

  function update<K extends keyof Requirements>(field: K, value: Requirements[K]) {
    setRequirements((previous) => ({ ...previous, [field]: value }));
  }

  async function connect(action: "test" | "save") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ action, connectionString: url }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not complete database setup.");
      setMessage(result.message);
      setTested(true);
      if (action === "save") { setSaved(true); setStatus((previous) => previous ? { ...previous, configured: true, databaseVariable: "DATABASE_URL" } : previous); setUrl(""); setKey(""); }
    } catch (e) {
      setTested(false);
      setError(e instanceof Error ? e.message : "Request failed. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-600">Database setup</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">A home for your portfolio</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Tell us what you need. We’ll help you choose a database and securely verify your connection.</p>
        </div>
        {status && <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.databaseVariable ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-800"}`}>{saved ? "Connected" : status.databaseVariable ? `${status.databaseVariable} detected · not yet verified` : "Not connected"}</span>}
      </div>

      {status && <div className={`rounded-xl border p-4 text-sm ${status.databaseVariable ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-indigo-200 bg-indigo-50 text-slate-700"}`}>
        <p className="font-semibold">{status.databaseVariable ? <>Database setting detected: <code className="rounded bg-white/80 px-1.5 py-0.5">{status.databaseVariable}</code></> : <>Looking for <code className="rounded bg-white/80 px-1.5 py-0.5">DATABASE_URL</code>?</>}</p>
        {status.databaseVariable ? <>
          <p className="mt-1">The app reads <code>{status.databaseVariable}</code> automatically, so you do not need to paste the connection string here. This confirms the setting exists, but does not verify the database is reachable.</p>
          <a className="mt-2 inline-block font-medium text-indigo-700 underline" href="/api/health">Check database connection</a>
        </> : <p className="mt-1">In Vercel, open your project → <strong>Settings → Environment Variables</strong> and search for <code>DATABASE_URL</code>. This app also detects <code>POSTGRES_URL</code> when provided by a Vercel database integration. If Vercel says the database is connected but neither setting appears here, attach it to this project and environment, then redeploy. You should not need to paste the URL into this website.</p>}
      </div>}

      <ol className="grid grid-cols-3 gap-2 text-xs sm:text-sm" aria-label="Setup progress">
        {steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`border-t-2 pt-3 text-sm ${index === step ? "border-indigo-600 font-semibold text-indigo-700" : "border-slate-200 text-slate-500"}`}><span className="mr-2">0{index + 1}</span>{label}</li>)}
      </ol>

      <div className="card p-5 sm:p-8">
        {step === 0 && <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setProvider(recommendation.provider); setStep(1); }}>
          <div><h2 className="text-xl font-semibold">What does your database need to do?</h2><p className="mt-1 text-sm text-slate-500">Your answers tailor the recommendation. No database is created or purchased for you.</p></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2"><span className="label">Where will you run Ledgerly?</span><select className="input" value={requirements.hosting} onChange={(e) => update("hosting", e.target.value as Requirements["hosting"])}><option value="vercel">Vercel / serverless hosting</option><option value="server">My own server / other cloud</option><option value="local">Only on my computer</option></select></label>
            <label className="space-y-2"><span className="label">What is your budget?</span><select className="input" value={requirements.budget} onChange={(e) => update("budget", e.target.value as Requirements["budget"])}><option value="free">Start free / low cost</option><option value="paid">Paid managed service is fine</option></select></label>
            <label className="space-y-2"><span className="label">How much usage do you expect?</span><select className="input" value={requirements.scale} onChange={(e) => update("scale", e.target.value as Requirements["scale"])}><option value="personal">Personal portfolio</option><option value="team">Small team / shared portfolio</option><option value="large">Large portfolio / heavy usage</option></select></label>
            <label className="space-y-2"><span className="label">What matters most?</span><select className="input" value={requirements.features} onChange={(e) => update("features", e.target.value as Requirements["features"])}><option value="portfolio">Simple portfolio storage</option><option value="auth">Future authentication / file storage</option><option value="control">Control over my infrastructure</option></select></label>
          </div>
          <label className="block"><span className="label">Anything else? <span className="normal-case">(optional)</span></span><textarea className="input min-h-24" maxLength={2000} value={requirements.notes} onChange={(e) => update("notes", e.target.value)} placeholder="For example: Singapore region, daily backups, existing database, compliance needs…" /><span className="mt-1 block text-xs text-slate-500">Notes stay in this page only, for your setup checklist. They are not automatically analyzed. Do not include passwords.</span></label>
          <button type="submit" className="btn-primary">See my recommendation →</button>
        </form>}

        {step === 1 && <div className="space-y-6">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Recommended for your requirements</p><h2 className="mt-2 text-xl font-semibold">PostgreSQL on {providers.find((p) => p.id === recommendation.provider)?.name}</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
          <fieldset><legend className="mb-3 font-semibold">Choose a database type</legend><div className="grid gap-3 sm:grid-cols-2">{databaseTypes.map((item) => <label key={item.id} className={`cursor-pointer rounded-xl border p-4 transition ${type === item.id ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500" : "border-slate-200 hover:border-slate-400"}`}><span className="flex items-center gap-2 font-medium"><input type="radio" name="databaseType" value={item.id} checked={type === item.id} onChange={() => setType(item.id)} className="accent-indigo-600" />{item.name}<span className="ml-auto text-xs text-slate-500">{item.compatible ? "Supported" : "Compare only"}</span></span><span className="mt-2 block text-sm text-slate-500">{item.description}</span></label>)}</div></fieldset>
          {type !== "postgres" ? <div role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Ledgerly currently supports PostgreSQL only. This database type needs development work before it can store your portfolio. Select PostgreSQL to continue; no unsupported connection will be attempted.</div> : <fieldset><legend className="mb-3 font-semibold">Choose a PostgreSQL provider</legend><div className="grid gap-3 sm:grid-cols-3">{providers.map((p) => <label key={p.id} className={`cursor-pointer rounded-xl border p-4 ${provider === p.id ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500" : "border-slate-200"}`}><span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="provider" checked={provider === p.id} onChange={() => setProvider(p.id)} className="accent-indigo-600" />{p.name}</span><span className="mt-2 block text-xs leading-relaxed text-slate-500">{p.detail}</span></label>)}</div></fieldset>}
          {requirements.notes.trim() && <div className="rounded-xl bg-slate-50 p-4 text-sm"><h3 className="font-semibold">Your additional requirements</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-600">{requirements.notes}</p><p className="mt-2 text-xs text-slate-500">Confirm these with your provider before connecting, including region, backups, and compliance.</p></div>}
          <div className="flex justify-between gap-3"><button className="btn-ghost" onClick={() => setStep(0)}>← Requirements</button><button className="btn-primary" disabled={type !== "postgres"} onClick={() => setStep(2)}>Continue to connection →</button></div>
        </div>}

        {step === 2 && <div className="space-y-6">
          <div><h2 className="text-xl font-semibold">Connect {selectedProvider.name}</h2><p className="mt-2 text-sm text-slate-500">{selectedProvider.instruction}</p><a className="mt-2 inline-block text-sm font-medium text-indigo-600 underline" href={selectedProvider.url} target="_blank" rel="noreferrer">Open {selectedProvider.name} ↗</a></div>
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p className="font-semibold text-slate-800">Before you connect</p><ul className="mt-2 list-disc space-y-1 pl-5"><li>Use a dedicated database and database user, not a production database belonging to another app.</li><li>Allow network access from this app’s server. Remote connections require a trusted TLS certificate.</li><li>Grant USAGE and CREATE on the public schema. Tables are created when you open the dashboard.</li><li>{requirements.hosting === "vercel" ? "Use a pooled endpoint for serverless hosting; choose a region near your deployment." : "Use a reachable host. Localhost works only if the database and app run on the same machine."}</li></ul></div>
          {statusError && <p role="alert" className="text-sm text-rose-700">Could not load setup status. Reload this page to try again.</p>}
          {!status && !statusError && <p role="status" className="text-sm text-slate-500">Loading connection settings…</p>}
          {status && !status.setupEnabled && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Administrator setup key required</p><p className="mt-1">Set <code>DATABASE_SETUP_TOKEN</code> on the server to a random secret of at least 32 characters, then restart or redeploy. This protects database configuration from public visitors. Use the key below; never put it in a NEXT_PUBLIC variable.</p></div>}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void connect("test"); }}>
            <label className="block"><span className="label">Administrator setup key</span><input className="input" type="password" autoComplete="off" value={key} disabled={busy || saved} onChange={(e) => { setKey(e.target.value); setTested(false); }} placeholder="Your DATABASE_SETUP_TOKEN" required /></label>
            <label className="block"><span className="label">PostgreSQL connection string</span><input className="input font-mono" type={showUrl ? "text" : "password"} autoComplete="off" spellCheck={false} value={url} maxLength={4096} disabled={busy || saved} onChange={(e) => { setUrl(e.target.value); setTested(false); setMessage(""); setError(""); }} placeholder="postgresql://user:password@host:5432/database" required /><span className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500"><span>Sent only to this app’s server. Not stored in your browser or logs.</span><button type="button" className="shrink-0 text-indigo-600 underline" onClick={() => setShowUrl(!showUrl)}>{showUrl ? "Hide URL" : "Show URL"}</button></span></label>
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
            {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
            {!saved && <button type="submit" className="btn-primary" disabled={busy || !status?.setupEnabled}>{busy ? "Connecting…" : "Test connection"}</button>}
          </form>
          {status?.canSave && !saved && <div className="space-y-3 border-t border-slate-100 pt-5"><p className="text-sm text-slate-600">Save writes the verified URL to this server’s private <code>.env.local</code> file and switches the app to that database. Existing data is not copied or deleted.</p><label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" className="mt-1 accent-indigo-600" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />I understand this changes the database for everyone using this app.</label><button className="btn-primary" disabled={!tested || !confirmed || busy} onClick={() => void connect("save")}>Save & connect on this server</button></div>}
          {status && !status.canSave && <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-slate-700"><h3 className="font-semibold">Finish setup in {status.vercel ? "Vercel" : "your hosting dashboard"}</h3><p>Testing does not save the connection. This deployment cannot persist a configuration file.</p><ol className="list-decimal space-y-2 pl-5"><li>{status.vercel ? "Open your Vercel project → Settings → Environment Variables." : "Open your host’s environment variable settings."}</li><li>Add <code>DATABASE_URL</code> with the same verified connection string. Choose the correct deployment environment; keep Preview separate from Production.</li><li>Redeploy, then open the dashboard. Ledgerly initializes its tables automatically.</li></ol><p className="text-xs">Alternatively, connect Neon through Vercel Storage. This page does not create provider accounts or change your hosting environment.</p></div>}
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5"><button className="btn-ghost" disabled={busy} onClick={() => setStep(1)}>← Database choice</button><Link className="btn-ghost" href="/">{saved ? "Open portfolio →" : "Back to dashboard"}</Link></div>
        </div>}
      </div>
      <p className="text-center text-xs text-slate-400">Keep credentials private. Never commit connection strings or share your setup key. PostgreSQL is the only currently supported engine.</p>
    </section>
  );
}
