"use client";

import { useEffect, useRef, useState } from "react";

type Status = { configured: boolean; authRequired: boolean };
type Mode = "merge" | "replace";

export default function DatabaseTransfer() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [key, setKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("merge");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"export" | "import" | "clear" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clearPhrase, setClearPhrase] = useState("");
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [clearError, setClearError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/database/export", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setStatus)
      .catch(() => setStatusError(true));
  }, []);

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "X-Requested-With": "XMLHttpRequest" };
    if (status?.authRequired) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  async function exportDatabase() {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/database/export?download=1", { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Export failed.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "ledgerly-backup.json";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage("Backup downloaded. Keep the file somewhere safe — it contains your full portfolio history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function importDatabase(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (mode === "replace" && !window.confirm("Replace the entire database? All current assets, transactions, and snapshots will be deleted and replaced by this backup. This cannot be undone.")) return;
    setBusy("import");
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      if (mode === "replace") form.set("confirmReplace", "true");
      const response = await fetch("/api/database/import", { method: "POST", headers: authHeaders(), body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setMessage(result.message);
      setFile(null);
      setConfirmed(false);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function clearDatabase() {
    if (clearPhrase !== "DELETE ALL MY DATA" || !backupAcknowledged) return;
    const finalWarning = [
      "FINAL WARNING — PERMANENT DELETION",
      "",
      "This will immediately erase every asset, transaction, cash balance, and portfolio history snapshot.",
      "",
      "There is no undo button. The only recovery method is a previously exported backup file.",
      "",
      "Are you absolutely certain you want to permanently delete everything?",
    ].join("\n");
    if (!window.confirm(finalWarning)) return;

    setBusy("clear");
    setClearError("");
    setMessage("");
    try {
      const response = await fetch("/api/database/clear", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ confirmation: clearPhrase, backupAcknowledged }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not clear the database.");
      setMessage(result.message);
      setClearPhrase("");
      setBackupAcknowledged(false);
      window.setTimeout(() => { window.location.href = "/"; }, 1200);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "Could not clear the database.");
    } finally {
      setBusy(null);
    }
  }

  const keyMissing = Boolean(status?.authRequired && !key);
  const clearReady = clearPhrase === "DELETE ALL MY DATA" && backupAcknowledged;

  return (
    <section className="mx-auto mt-6 max-w-4xl space-y-6">
      <div className="card p-5 sm:p-8">
        <p className="text-sm font-semibold text-indigo-600">Backup &amp; restore</p>
        <h2 className="mt-2 text-xl font-semibold">Export &amp; import database</h2>
        <p className="mt-2 text-sm text-slate-500">
          Download a portable JSON backup of your custom database — every asset, transaction, and snapshot — or restore one
          into the currently connected database. Use this to move between databases (for example Neon ↔ Supabase), keep
          offline backups, or recover after a mistake.
        </p>

        {statusError && <p role="alert" className="mt-4 text-sm text-rose-700">Could not load backup settings. Reload this page to try again.</p>}
        {!status && !statusError && <p role="status" className="mt-4 text-sm text-slate-500">Loading backup settings…</p>}
        {status && !status.configured && (
          <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            No database is connected yet. Finish the connection setup above before exporting or importing.
          </p>
        )}

        {status?.authRequired && (
          <label className="mt-5 block">
            <span className="label">Administrator setup key</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={key}
              disabled={busy !== null}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Your DATABASE_SETUP_TOKEN"
            />
            <span className="mt-1 block text-xs text-slate-500">Required because DATABASE_SETUP_TOKEN is set on this server. It is sent only to this app and never stored in your browser.</span>
          </label>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold">Export database</h3>
            <p className="text-sm text-slate-500">One JSON file (format version 1) with all assets, transactions, and snapshots. Derived balances are recomputed from transactions when the file is imported, so it stays trustworthy even if edited.</p>
            <button type="button" className="btn-primary" disabled={!status?.configured || busy !== null || keyMissing} onClick={() => void exportDatabase()}>
              {busy === "export" ? "Preparing…" : "⬇ Export database (.json)"}
            </button>
          </div>

          <form className="space-y-4 rounded-xl border border-slate-200 p-5" onSubmit={(e) => void importDatabase(e)}>
            <h3 className="font-semibold">Import database</h3>
            <label className="block">
              <span className="label">Backup file</span>
              <input
                ref={fileInput}
                className="input"
                type="file"
                accept="application/json,.json"
                disabled={busy !== null}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMessage(""); setError(""); }}
              />
              <span className="mt-1 block text-xs text-slate-500">Ledgerly backup (.json), up to 10 MB. The file is validated before anything is written, and the import runs as a single transaction — a failed import changes nothing.</span>
            </label>
            <fieldset className="space-y-2">
              <legend className="label">Import mode</legend>
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input type="radio" name="importMode" className="mt-1 accent-indigo-600" checked={mode === "merge"} onChange={() => setMode("merge")} />
                <span><strong className="text-slate-800">Merge</strong> — keep existing data; imported assets get new ids. Snapshots for dates already present are overwritten.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input type="radio" name="importMode" className="mt-1 accent-indigo-600" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span><strong className="text-slate-800">Replace</strong> — delete everything in the connected database and restore the backup exactly, including ids.</span>
              </label>
            </fieldset>
            {mode === "replace" && (
              <label className="flex items-start gap-2 text-sm text-rose-700">
                <input type="checkbox" className="mt-1 accent-rose-600" checked={confirmed} disabled={busy !== null} onChange={(e) => setConfirmed(e.target.checked)} />
                I understand this permanently deletes the current database contents. I have exported a backup first.
              </label>
            )}
            <button type="submit" className={mode === "replace" ? "btn-danger" : "btn-primary"} disabled={!status?.configured || busy !== null || !file || keyMissing || (mode === "replace" && !confirmed)}>
              {busy === "import" ? "Importing…" : mode === "replace" ? "Replace database with backup" : "Merge backup into database"}
            </button>
          </form>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border-2 border-rose-500 bg-white shadow-[0_12px_40px_rgba(225,29,72,0.12)]">
        <div className="bg-rose-600 px-5 py-3 text-white sm:px-8">
          <p className="text-sm font-black uppercase tracking-[0.16em]">⚠ Critical danger zone</p>
        </div>
        <div className="space-y-5 p-5 sm:p-8">
          <div>
            <h2 className="text-xl font-bold text-rose-700">Permanently clear all portfolio data</h2>
            <p className="mt-2 text-sm font-medium text-slate-700">
              This erases every asset, cash balance, transaction, realized gain, and history snapshot from the connected database.
              This action cannot be undone.
            </p>
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Back up your data before continuing.</p>
            <p className="mt-1">Use “Export database (.json)” above and verify the downloaded file is stored safely. A backup is the only way to recover after deletion.</p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-rose-200 p-4 text-sm text-rose-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
              checked={backupAcknowledged}
              disabled={busy !== null}
              onChange={(e) => setBackupAcknowledged(e.target.checked)}
            />
            <span><strong>I understand there is no undo.</strong> I have exported a current backup, or I accept that this data will be permanently unrecoverable.</span>
          </label>

          <label className="block">
            <span className="label text-rose-700">Type DELETE ALL MY DATA to confirm</span>
            <input
              className="input border-rose-300 focus:border-rose-500 focus:ring-rose-100"
              value={clearPhrase}
              onChange={(e) => setClearPhrase(e.target.value)}
              placeholder="DELETE ALL MY DATA"
              autoComplete="off"
              spellCheck={false}
              disabled={busy !== null}
            />
          </label>

          {clearError && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">{clearError}</p>}

          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            disabled={!status?.configured || busy !== null || keyMissing || !clearReady}
            onClick={() => void clearDatabase()}
          >
            {busy === "clear" ? "Permanently deleting…" : "Permanently delete everything"}
          </button>
          <p className="text-xs text-slate-500">A final browser confirmation will appear before deletion starts. The server also verifies the exact confirmation phrase.</p>
        </div>
      </div>
    </section>
  );
}
