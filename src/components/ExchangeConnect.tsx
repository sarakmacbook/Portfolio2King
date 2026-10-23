"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  disconnectExchangeAction,
  saveExchangeKeyAction,
  syncAllExchangesAction,
  syncExchangeAction,
  type ExchangeActionState,
} from "@/app/exchange-actions";
import type { ExchangeCredentialSummary } from "@/lib/exchange-credentials";
import { EXCHANGE_IDS, EXCHANGE_KEY_HELP, EXCHANGE_LABELS, type ExchangeId } from "@/lib/exchanges";
import type { ExchangeSyncResult } from "@/lib/exchange-sync";

const EMPTY: ExchangeActionState = {};

function timeAgo(iso?: string): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function pendingLabel(pending: boolean, idle: string, busy: string) {
  return pending ? busy : idle;
}

function Note({ state }: { state: ExchangeActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
        {state.error}
      </p>
    );
  }
  if (!state.ok) return null;
  return (
    <div className="space-y-1">
      {state.message && (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
          {state.message}
        </p>
      )}
      {state.warning && (
        <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          {state.warning}
        </p>
      )}
      <ResultDetails result={state.result} />
    </div>
  );
}

/** The "what changed" list — enough detail to trust an automatic import. */
function ResultDetails({ result }: { result?: ExchangeSyncResult }) {
  if (!result || result.changes.length === 0) return null;
  return (
    <ul className="space-y-0.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
      {result.changes.slice(0, 12).map((change) => (
        <li key={`${change.symbol}-${change.kind}`} className="flex justify-between gap-3 tabular-nums">
          <span>
            {change.delta > 0 ? "+" : "−"}
            {formatQty(Math.abs(change.delta))} {change.symbol}
          </span>
          <span className="text-slate-400">{change.created ? "new holding" : change.kind === "deposit" ? "added" : "removed"}</span>
        </li>
      ))}
      {result.changes.length > 12 && (
        <li className="text-slate-400">…and {result.changes.length - 12} more</li>
      )}
    </ul>
  );
}

function formatQty(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function SyncSubmit({ idle }: { idle: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-ghost" disabled={pending}>
      {pendingLabel(pending, idle, "Syncing…")}
    </button>
  );
}

function ConnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
      {pendingLabel(pending, "Connect & import", "Checking key…")}
    </button>
  );
}

function DisconnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-danger" disabled={pending}>
      {pendingLabel(pending, "Disconnect", "Disconnecting…")}
    </button>
  );
}

function ConnectForm({ exchange }: { exchange: ExchangeId }) {
  const [state, action] = useActionState(saveExchangeKeyAction, EMPTY);
  const label = EXCHANGE_LABELS[exchange];
  const fieldId = (name: string) => `${exchange}-${name}`;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="exchange" value={exchange} />
      <p className="text-xs text-slate-500">{EXCHANGE_KEY_HELP[exchange]}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600" htmlFor={fieldId("key")}>
          API key
          <input
            id={fieldId("key")}
            name="apiKey"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={exchange === "okx" ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "Paste your API key"}
            className="input mt-1 w-full font-mono text-xs"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600" htmlFor={fieldId("secret")}>
          API secret
          <input
            id={fieldId("secret")}
            name="apiSecret"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your API secret"
            className="input mt-1 w-full font-mono text-xs"
          />
        </label>
        {exchange === "okx" && (
          <label className="block text-xs font-medium text-slate-600" htmlFor={fieldId("passphrase")}>
            Passphrase
            <input
              id={fieldId("passphrase")}
              name="passphrase"
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="The passphrase you set on the key"
              className="input mt-1 w-full font-mono text-xs"
            />
          </label>
        )}
        {exchange === "bybit" && (
          <label className="block text-xs font-medium text-slate-600" htmlFor={fieldId("account")}>
            Account type
            <select id={fieldId("account")} name="accountType" defaultValue="UNIFIED" className="input mt-1 w-full">
              <option value="UNIFIED">Unified trading</option>
              <option value="SPOT">Spot</option>
              <option value="CONTRACT">Contract</option>
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ConnectSubmit />
        <span className="text-xs text-slate-400">Read-only keys only — never enable trading or withdrawals.</span>
      </div>
      <Note state={state} />
    </form>
  );
}

function ConnectedPanel({
  exchange,
  summary,
  lastSync,
}: {
  exchange: ExchangeId;
  summary: ExchangeCredentialSummary;
  lastSync?: string;
}) {
  const [state, action] = useActionState(syncExchangeAction, EMPTY);
  const [disconnectState, disconnectAction] = useActionState(disconnectExchangeAction, EMPTY);
  const label = EXCHANGE_LABELS[exchange];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Connected
        </span>
        <span className="font-mono text-slate-600">{summary.hint}</span>
        {summary.accountType && <span>{summary.accountType}</span>}
        <span>Added {timeAgo(summary.savedAt)}</span>
        <span>Synced {timeAgo(lastSync)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action={action} className="contents">
          <input type="hidden" name="exchange" value={exchange} />
          <SyncSubmit idle={`Sync ${label} now`} />
        </form>
        <form action={disconnectAction} className="contents">
          <input type="hidden" name="exchange" value={exchange} />
          <DisconnectSubmit />
        </form>
      </div>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-700">Replace the key</summary>
        <div className="pt-3">
          <ConnectForm exchange={exchange} />
        </div>
      </details>

      <Note state={state} />
      <Note state={disconnectState} />
    </div>
  );
}

export default function ExchangeConnect({
  summaries,
  lastSync,
}: {
  summaries: Record<ExchangeId, ExchangeCredentialSummary | null>;
  lastSync: Partial<Record<ExchangeId, string>>;
}) {
  const connectedCount = EXCHANGE_IDS.filter((id) => summaries[id]).length;
  const [allState, allAction] = useActionState(syncAllExchangesAction, EMPTY);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Exchanges</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Connect Binance, OKX or Bybit with a <strong>read-only</strong> API key and import your spot balances.
            Imported units are booked into your portfolio as deposits, so cost basis, P/L and Activity stay
            accurate — and syncing again only applies what changed.
          </p>
        </div>
        {connectedCount > 0 && (
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {connectedCount} of {EXCHANGE_IDS.length} connected
            </span>
            <form action={allAction}>
              <SyncSubmit idle="Sync all exchanges" />
            </form>
          </div>
        )}
      </div>

      <Note state={allState} />

      <div className="grid gap-4 xl:grid-cols-3">
        {EXCHANGE_IDS.map((exchange) => {
          const summary = summaries[exchange];
          return (
            <section key={exchange} className="card p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{EXCHANGE_LABELS[exchange]}</h2>
                {!summary && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    Not connected
                  </span>
                )}
              </div>
              {summary ? (
                <ConnectedPanel exchange={exchange} summary={summary} lastSync={lastSync[exchange]} />
              ) : (
                <ConnectForm exchange={exchange} />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
