"use client";

import { useCallback, useEffect, useState } from "react";
import {
  removeScannerKeyAction,
  saveScannerKeyAction,
} from "@/app/scanner-actions";
import type { ScannerKeyStatus } from "@/lib/scanner-keys";

/**
 * "Scanner API keys" — the in-app home for the three scan keys.
 *
 * The scan sources work without a key but read fewer tokens, and the fixes used
 * to be environment variables only. This panel saves a key in the app (encrypted,
 * `scanner-keys`) and shows only a mask of it afterwards. A key stored here wins
 * over `DEBANK_ACCESS_KEY` / `ETHERSCAN_API_KEY` / `MORALIS_API_KEY`, and removing
 * it puts the environment back in charge.
 *
 * It is rendered inside the add-holding form, so it deliberately uses buttons and
 * imperative action calls instead of nested `<form>` elements, which HTML does
 * not allow.
 */

type LoadState = "idle" | "ready" | "error";

export default function ScannerKeys({
  defaultOpen = false,
  highlight = "",
}: {
  defaultOpen?: boolean;
  /** Provider whose missing key was just reported by a scan — opens the panel. */
  highlight?: string;
}) {
  const [statuses, setStatuses] = useState<ScannerKeyStatus[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [databaseConfigured, setDatabaseConfigured] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  /**
   * Open state is tracked so the disclosure stays open across re-renders. The
   * caller remounts the panel (keyed on `highlight`) when a scan hits a missing
   * key, which reopens it on the row that needs one.
   */
  const [open, setOpen] = useState(defaultOpen || Boolean(highlight));

  /**
   * Fetches the masked statuses. Nothing is set before the first `await` so this
   * can also be called from the mount effect — see the loading label below.
   */
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet/scan/keys", { cache: "no-store" });
      const data = (await response.json()) as {
        keys?: ScannerKeyStatus[];
        databaseConfigured?: boolean;
        error?: string;
      };
      setStatuses(data.keys ?? []);
      setDatabaseConfigured(data.databaseConfigured ?? true);
      setLoadState(data.error ? "error" : "ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  // The panel can mount already open (a scan reported a missing key), so the
  // statuses are fetched whenever it is open and has none yet.
  useEffect(() => {
    if (!open || loadState !== "idle") return;
    // Deferred so the effect body does not set state synchronously during render.
    void Promise.resolve().then(() => load());
  }, [open, loadState, load]);

  async function save(status: ScannerKeyStatus) {
    const draft = (drafts[status.id] ?? "").trim();
    if (!draft) {
      setNotes((current) => ({ ...current, [status.id]: { ok: false, text: "Paste your API key first." } }));
      return;
    }
    setBusy(status.id);
    try {
      const form = new FormData();
      form.set("provider", status.id);
      form.set("apiKey", draft);
      const result = await saveScannerKeyAction({}, form);
      if (result.error) {
        setNotes((current) => ({ ...current, [status.id]: { ok: false, text: result.error! } }));
      } else {
        setNotes((current) => ({
          ...current,
          [status.id]: { ok: true, text: result.message ?? `${status.label} key saved.` },
        }));
        setDrafts((current) => ({ ...current, [status.id]: "" }));
      }
    } catch {
      setNotes((current) => ({
        ...current,
        [status.id]: { ok: false, text: "Could not save that key — try again." },
      }));
    } finally {
      setBusy("");
      void load();
    }
  }

  async function remove(status: ScannerKeyStatus) {
    setBusy(status.id);
    try {
      const form = new FormData();
      form.set("provider", status.id);
      const result = await removeScannerKeyAction({}, form);
      setNotes((current) => ({
        ...current,
        [status.id]: result.error
          ? { ok: false, text: result.error }
          : { ok: true, text: result.message ?? `${status.label} key removed.` },
      }));
    } catch {
      setNotes((current) => ({
        ...current,
        [status.id]: { ok: false, text: "Could not remove that key — try again." },
      }));
    } finally {
      setBusy("");
      void load();
    }
  }

  const configuredCount = statuses.filter((status) => status.configured).length;

  return (
    <details
      className="mt-2 rounded-xl border border-indigo-100 bg-white/70 px-3 py-2 text-xs text-slate-600"
      open={open}
      onToggle={(event: React.SyntheticEvent<HTMLDetailsElement>) => {
        // Nothing is fetched until the panel is opened: the effect above loads
        // the statuses once, so the dialog stays quiet by default.
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer font-medium text-slate-700">
        Scanner API keys{" "}
        <span className="font-normal text-slate-400">
          {loadState === "ready"
            ? configuredCount > 0
              ? `(${configuredCount} of ${statuses.length} configured)`
              : "(optional — the scan works without them)"
            : "(optional)"}
        </span>
        {highlight && loadState === "ready" && !statuses.find((s) => s.id === highlight)?.configured && (
          <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
            key needed
          </span>
        )}
      </summary>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        A key is saved encrypted in the app and never shown again — only its last four characters
        are displayed. The environment variables still work, and a key saved here wins over them.
      </p>

      {!databaseConfigured && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
          Connect a database first: saved keys live in the app settings table. Until then, set the
          environment variables instead.
        </p>
      )}

      {loadState === "idle" && open && <p className="mt-2 text-[11px] text-slate-400">Loading keys…</p>}
      {loadState === "error" && (
        <p className="mt-2 text-[11px] text-rose-600">
          Could not read the saved keys.
          <button type="button" className="ml-1 font-medium underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {statuses.length > 0 && (
        <ul className="mt-2 space-y-2">
          {statuses.map((status) => {
            const note = notes[status.id];
            const isBusy = busy === status.id;
            return (
              <li
                key={status.id}
                className={`rounded-lg border bg-white p-2 ${
                  highlight === status.id && !status.configured
                    ? "border-amber-300 ring-1 ring-amber-200"
                    : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium text-slate-700">{status.label}</span>
                  {status.configured ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                      {status.source === "app" ? "Saved in app" : "From environment"} · {status.hint}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      No key
                    </span>
                  )}
                </div>

                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{status.usedFor}</p>

                <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                  <input
                    type="password"
                    className="input min-w-0 flex-1 text-xs"
                    value={drafts[status.id] ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [status.id]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        // Enter must not submit the surrounding add-holding form.
                        event.preventDefault();
                        void save(status);
                      }
                    }}
                    placeholder={status.configured ? "Paste a new key to replace it" : status.format}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`${status.label} API key`}
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      onClick={() => void save(status)}
                      disabled={isBusy || !databaseConfigured}
                    >
                      {isBusy ? "Saving…" : status.configured ? "Replace" : "Save key"}
                    </button>
                    {status.removable && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => void remove(status)}
                        disabled={isBusy}
                      >
                        Remove
                      </button>
                    )}
                    <a
                      href={status.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-medium text-indigo-600 hover:underline"
                    >
                      Get a key
                    </a>
                  </div>
                </div>

                {status.configured && status.source === "env" && (
                  <p className="mt-1 text-[10px] text-slate-400">
                    Set by {status.envVar}. Saving a key here overrides it.
                  </p>
                )}
                {note && (
                  <p
                    role={note.ok ? "status" : "alert"}
                    className={`mt-1 text-[11px] ${note.ok ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {note.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
