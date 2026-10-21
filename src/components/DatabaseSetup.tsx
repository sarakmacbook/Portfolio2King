"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  databaseTypes,
  providers,
  recommendDatabase,
  type Requirements,
} from "@/lib/database-options";

type Status = {
  configured: boolean;
  setupEnabled: boolean;
  canSave: boolean;
  vercel: boolean;
};
type ProviderId = (typeof providers)[number]["id"];

async function getStatus(): Promise<Status> {
  const response = await fetch("/api/database", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load setup status.");
  return response.json();
}

export default function DatabaseSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("neon");
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requirements, setRequirements] = useState<Requirements>({
    hosting: "vercel",
    budget: "free",
    scale: "personal",
    features: "portfolio",
    notes: "",
  });
  const selectedProvider = providers.find((p) => p.id === provider)!;
  const recommendation = recommendDatabase(requirements);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getStatus());
      setStatusError(false);
    } catch {
      setStatusError(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getStatus()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        if (active) setStatusError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function resetResult() {
    setTested(false);
    setMessage("");
    setError("");
  }

  async function connect(action: "test" | "save") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const send = () =>
        fetch("/api/database", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ action, connectionString: url.trim() }),
        });
      let response = await send();
      // The server throttles attempts; a save immediately after a successful
      // test should wait and retry once instead of forcing another click.
      if (response.status === 429) {
        await new Promise((resolve) => window.setTimeout(resolve, 2100));
        response = await send();
      }
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not complete database setup.");
      setMessage(result.message);
      setTested(true);
      if (action === "save") {
        setSaved(true);
        setStatus((previous) =>
          previous ? { ...previous, configured: true } : previous,
        );
        setUrl("");
        setKey("");
      }
    } catch (e) {
      setTested(false);
      setError(
        e instanceof Error ? e.message : "Request failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function update<K extends keyof Requirements>(
    field: K,
    value: Requirements[K],
  ) {
    setRequirements((previous) => ({ ...previous, [field]: value }));
  }

  function showProviderHelp() {
    const help = document.querySelector<HTMLDetailsElement>("#provider-help");
    if (help) {
      help.open = true;
      help.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-600">
            Database setup
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Connect your portfolio
          </h1>
          <p className="mt-2 max-w-2xl text-slate-500">
            Already have a PostgreSQL URL? Paste it below. No questionnaire or
            database migration required to test it.
          </p>
        </div>
        {status && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${status.configured ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-800"}`}
          >
            {saved
              ? "Connected"
              : status.configured
                ? "Configured · not verified here"
                : "Not connected"}
          </span>
        )}
      </div>

      <div className="card space-y-6 p-5 sm:p-8">
        <div>
          <h2 className="text-lg font-semibold">
            1. Paste your PostgreSQL URL and setup key
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Don’t have a URL yet?{" "}
            <button
              type="button"
              className="font-medium text-indigo-600 underline"
              onClick={showProviderHelp}
            >
              Find a PostgreSQL provider
            </button>
          </p>
          {statusError && (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              Could not load setup status.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void loadStatus()}
              >
                Try again
              </button>
            </p>
          )}
          {!status && !statusError && (
            <p role="status" className="mt-3 text-sm text-slate-500">
              Loading connection settings…
            </p>
          )}
          {status && !status.setupEnabled && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Set up an administrator key first</p>
              <p className="mt-1">
                For security, the connection form needs a private{" "}
                <code>DATABASE_SETUP_TOKEN</code> on the app server (at least 32
                characters). Generate one with:
              </p>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-white p-2 text-xs select-all">
                {
                  "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
                }
              </code>
              <p className="mt-2">
                Locally, add{" "}
                <code>DATABASE_SETUP_TOKEN=your-generated-key</code> to{" "}
                <code>.env.local</code> and restart the app. On Vercel, add it
                in Project → Settings → Environment Variables and redeploy. Then
                enter the same key below. Never use a <code>NEXT_PUBLIC_</code>{" "}
                variable.
              </p>
              <button
                type="button"
                className="mt-3 font-medium underline"
                onClick={() => void loadStatus()}
              >
                I’ve restarted or redeployed — check again
              </button>
            </div>
          )}
          {status?.configured && !saved && (
            <p className="mt-4 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800">
              A database URL is already configured. You can test a new URL here,
              or connect a different database. Changing the saved URL changes
              the database for everyone; existing data is not moved.
            </p>
          )}
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void connect("test");
            }}
          >
            <label className="block">
              <span className="label">PostgreSQL connection string</span>
              <input
                className="input font-mono"
                type={showUrl ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={url}
                maxLength={4096}
                disabled={busy || saved}
                onChange={(e) => {
                  setUrl(e.target.value);
                  resetResult();
                }}
                placeholder="postgresql://user:password@host/database"
                required
              />
              <span className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>
                  Sent only to this app’s server; not saved in your browser.
                </span>
                <button
                  type="button"
                  className="shrink-0 text-indigo-600 underline"
                  onClick={() => setShowUrl(!showUrl)}
                >
                  {showUrl ? "Hide URL" : "Show URL"}
                </button>
              </span>
            </label>
            <label className="block">
              <span className="label">Administrator setup key</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={key}
                disabled={busy || saved}
                onChange={(e) => {
                  setKey(e.target.value);
                  resetResult();
                }}
                placeholder="Your DATABASE_SETUP_TOKEN"
                required
              />
              <span className="mt-1 block text-xs text-slate-500">
                Only you should know this key. It is not your database password.
              </span>
            </label>
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
              >
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"
              >
                {message}
              </p>
            )}
            {!saved && (
              <button
                type="submit"
                className="btn-ghost"
                disabled={busy || !status?.setupEnabled}
              >
                {busy ? "Checking…" : "Test connection"}
              </button>
            )}
          </form>
        </div>

        <div className="border-t border-slate-100 pt-6">
          <h2 className="text-lg font-semibold">2. Finish connecting</h2>
          {status?.canSave ? (
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p>
                This server can save the URL to its private{" "}
                <code>.env.local</code> file.{" "}
                <strong>Save &amp; connect</strong> also tests the connection,
                so testing separately is optional. The app will create its
                tables when you open the dashboard; existing data is not copied
                or deleted.
              </p>
              {!saved && (
                <>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 accent-indigo-600"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I understand this changes the database for everyone using
                    this app.
                  </label>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      !confirmed ||
                      busy ||
                      !status.setupEnabled ||
                      !url.trim() ||
                      !key
                    }
                    onClick={() => void connect("save")}
                  >
                    {busy ? "Connecting…" : "Save & connect"}
                  </button>
                </>
              )}
              {saved && (
                <Link href="/" className="btn-primary">
                  Open portfolio →
                </Link>
              )}
            </div>
          ) : status ? (
            <div className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-slate-700">
              <p className="font-semibold">
                Finish in {status.vercel ? "Vercel" : "your hosting dashboard"}
              </p>
              <p>
                This deployment cannot save configuration from the web UI.
                Testing above does not switch the database.
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  {status.vercel
                    ? "Open your Vercel project → Settings → Environment Variables."
                    : "Open your host’s environment variable settings."}
                </li>
                <li>
                  Add <code>DATABASE_URL</code> with the connection string you
                  pasted above. Keep Preview and Production databases separate.
                </li>
                <li>
                  Redeploy, then open the dashboard. Ledgerly creates its tables
                  automatically.
                </li>
              </ol>
              {tested && (
                <p role="status" className="font-medium text-indigo-800">
                  Your URL passed the connection test. It is ready to add as{" "}
                  <code>DATABASE_URL</code>.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Loading setup options…
            </p>
          )}
        </div>
      </div>

      <details id="provider-help" className="card p-5 sm:p-6">
        <summary className="cursor-pointer font-semibold text-slate-800">
          Need a PostgreSQL URL?{" "}
          <span className="font-normal text-slate-500">
            Get one from a provider
          </span>
        </summary>
        <div className="mt-5 space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Choose a provider</h2>
            <p className="mt-1 text-sm text-slate-500">
              Pick a provider to see where to find its connection string. Only
              PostgreSQL works with Ledgerly.
            </p>
            <div
              className="mt-4 grid gap-2 sm:grid-cols-3"
              role="group"
              aria-label="Database provider"
            >
              {providers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={provider === item.id}
                  onClick={() => setProvider(item.id)}
                  className={`rounded-xl border p-3 text-left text-sm transition ${provider === item.id ? "border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-500" : "border-slate-200 text-slate-700 hover:border-slate-400"}`}
                >
                  <span className="block font-semibold">{item.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed opacity-80">
                    {item.detail}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-600">
              {selectedProvider.instruction}{" "}
              <a
                className="font-medium text-indigo-600 underline"
                href={selectedProvider.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {selectedProvider.name} ↗
              </a>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              For serverless hosting, copy the <strong>pooled</strong>{" "}
              connection string. Use the database password, not an API key. Your
              database must allow this app’s server to connect and its user to
              create tables in the public schema.
            </p>
          </div>
        </div>
      </details>

      <details className="card p-5 sm:p-6">
        <summary className="cursor-pointer font-semibold text-slate-800">
          Need help choosing a database?{" "}
          <span className="font-normal text-slate-500">Optional guide</span>
        </summary>
        <div className="mt-5 space-y-5 text-sm">
          <p className="text-slate-500">
            Ledgerly only connects to PostgreSQL today. These preferences
            suggest a provider; they do not create an account or send your
            answers anywhere.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="label">Where will Ledgerly run?</span>
              <select
                className="input"
                value={requirements.hosting}
                onChange={(e) =>
                  update("hosting", e.target.value as Requirements["hosting"])
                }
              >
                <option value="vercel">Vercel / serverless</option>
                <option value="server">My own server / other cloud</option>
                <option value="local">Only on my computer</option>
              </select>
            </label>
            <label>
              <span className="label">Budget</span>
              <select
                className="input"
                value={requirements.budget}
                onChange={(e) =>
                  update("budget", e.target.value as Requirements["budget"])
                }
              >
                <option value="free">Start free / low cost</option>
                <option value="paid">Paid managed service is fine</option>
              </select>
            </label>
            <label>
              <span className="label">Expected usage</span>
              <select
                className="input"
                value={requirements.scale}
                onChange={(e) =>
                  update("scale", e.target.value as Requirements["scale"])
                }
              >
                <option value="personal">Personal portfolio</option>
                <option value="team">Small team</option>
                <option value="large">Heavy usage</option>
              </select>
            </label>
            <label>
              <span className="label">What matters most?</span>
              <select
                className="input"
                value={requirements.features}
                onChange={(e) =>
                  update("features", e.target.value as Requirements["features"])
                }
              >
                <option value="portfolio">Simple portfolio storage</option>
                <option value="auth">Future authentication / storage</option>
                <option value="control">Infrastructure control</option>
              </select>
            </label>
          </div>
          <div className="rounded-xl bg-indigo-50 p-4">
            <p className="font-semibold text-indigo-900">
              Suggested: PostgreSQL on{" "}
              {providers.find((p) => p.id === recommendation.provider)?.name}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
              {recommendation.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-3 font-medium text-indigo-700 underline"
              onClick={() => {
                setProvider(recommendation.provider);
                showProviderHelp();
              }}
            >
              See this provider
            </button>
          </div>
          <details>
            <summary className="cursor-pointer font-medium text-slate-700">
              Why not MySQL, SQLite or MongoDB?
            </summary>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-slate-500">
              {databaseTypes
                .filter((type) => !type.compatible)
                .map((type) => (
                  <li key={type.id}>
                    <strong>{type.name}:</strong> {type.description}
                  </li>
                ))}
            </ul>
          </details>
        </div>
      </details>
      <p className="text-center text-xs text-slate-400">
        Keep credentials private. Use HTTPS on hosted deployments. Web setup
        changes this app’s database, not a personal account.
      </p>
    </section>
  );
}
