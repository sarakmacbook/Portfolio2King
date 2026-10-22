"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { bulkUpdatePrices, type ActionState } from "@/app/actions";
import type { AssetType } from "@/lib/constants";
import { TYPE_META, money, pct, pnlColor, qty } from "@/lib/format";
import { PRICE_PROVIDERS, PROVIDER_LABELS, type PriceProvider } from "@/lib/market-prices";
import { ErrorNote, SubmitButton } from "./ui";
import CryptoLogo from "./CryptoLogo";

export type PriceRow = {
  id: number;
  type: AssetType;
  name: string;
  symbol: string;
  quantity: number;
  currentPrice: number;
  updated: string;
  snapshotsCount?: number;
};

export default function BulkPriceForm({ rows }: { rows: PriceRow[] }) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [state, action] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await bulkUpdatePrices(previous, formData);
    if (result.ok) setValues({});
    return result;
  }, {});
  const [provider, setProvider] = useState<PriceProvider>("bybit");
  const [quote, setQuote] = useState<"USD" | "USDT">("USDT");
  const [fetching, setFetching] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  async function loadLivePrices() {
    const crypto = rows.filter((row) => row.type === "crypto" && row.symbol.trim());
    const stocks = rows.filter((row) => row.type === "stock" && row.symbol.trim());
    if (!crypto.length && !stocks.length) {
      setLiveMessage("Add a symbol to at least one stock or crypto asset first.");
      return;
    }
    setFetching(true);
    setLiveMessage("");
    try {
      const response = await fetch("/api/prices/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          quote,
          // Crypto uses the chosen exchange; stocks always use Yahoo Finance.
          assets: [
            ...crypto.map(({ id, symbol }) => ({ id, symbol, type: "crypto" as const })),
            ...stocks.map(({ id, symbol }) => ({ id, symbol, type: "stock" as const })),
          ],
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        found?: number;
        results?: Array<{ id?: number; price?: number; error?: string }>;
      };
      if (!response.ok) throw new Error(data.error || "Could not reach the price source");
      const prices: Record<number, string> = {};
      for (const result of data.results || []) {
        if (result.id && result.price) prices[result.id] = String(result.price);
      }
      setValues((current) => ({ ...current, ...prices }));
      const total = crypto.length + stocks.length;
      const missing = total - (data.found || 0);
      const parts = [
        crypto.length ? `${crypto.length} crypto` : "",
        stocks.length ? `${stocks.length} stock${stocks.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      setLiveMessage(
        `${data.found || 0} live price${data.found === 1 ? "" : "s"} loaded (${parts.join(" + ")})${
          missing ? ` · ${missing} unavailable` : ""
        }. Review, then save.`,
      );
    } catch (error) {
      setLiveMessage(error instanceof Error ? error.message : "Could not load live prices");
    } finally {
      setFetching(false);
    }
  }

  const changes = rows.filter((r) => {
    const v = values[r.id];
    return v !== undefined && v.trim() !== "" && Number(v) !== r.currentPrice;
  });
  const delta = changes.reduce((s, r) => s + (Number(values[r.id]) - r.currentPrice) * r.quantity, 0);

  return (
    <form action={action}>
      <div className="border-b border-slate-100 bg-indigo-50/50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="label">Crypto price source</label>
            <select className="input" value={provider} onChange={(event) => setProvider(event.target.value as PriceProvider)}>
              {PRICE_PROVIDERS.map((value) => <option key={value} value={value}>{PROVIDER_LABELS[value]}</option>)}
            </select>
          </div>
          <div className="sm:w-32">
            <label className="label">Quote</label>
            <select className="input" value={quote} onChange={(event) => setQuote(event.target.value as "USD" | "USDT")}>
              <option value="USDT">USDT</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <button type="button" className="btn-primary sm:min-w-40" onClick={loadLivePrices} disabled={fetching}>
            {fetching ? "Fetching…" : "Fetch live prices"}
          </button>
        </div>
        <div className="mt-2 flex flex-col justify-between gap-1 text-xs text-slate-500 sm:flex-row">
          <span>
            Crypto uses the exchange above; stocks use Yahoo Finance. Public market-data APIs only — no API keys.
          </span>
          {liveMessage && <span className="font-medium text-indigo-600">{liveMessage}</span>}
        </div>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-3 py-3 text-right font-medium">Holdings</th>
              <th className="px-3 py-3 text-right font-medium">Current price</th>
              <th className="px-3 py-3 font-medium">New price</th>
              <th className="px-5 py-3 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const v = values[r.id] ?? "";
              const n = Number(v);
              const changed = v.trim() !== "" && isFinite(n) && n !== r.currentPrice;
              const chg = r.currentPrice > 0 ? (n - r.currentPrice) / r.currentPrice : 0;
              return (
                <tr key={r.id} className={changed ? "bg-indigo-50/40" : ""}>
                  <td className="px-5 py-3">
                    <Link href={`/assets/${r.id}`} className="group flex items-center gap-2">
                      {r.type === "crypto" ? (
                        <CryptoLogo symbol={r.symbol} name={r.name} className="h-7 w-7 rounded-lg" />
                      ) : (
                        <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[r.type].color }} />
                      )}
                      <span className="font-medium text-slate-900 group-hover:text-indigo-600">{r.symbol || r.name}</span>
                      {r.symbol && <span className="truncate text-slate-500">{r.name}</span>}
                    </Link>
                    <div className="ml-4 text-xs text-slate-400">
                      updated {r.updated}
                      {r.snapshotsCount ? ` · ${r.snapshotsCount} daily snapshot${r.snapshotsCount === 1 ? "" : "s"}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{qty(r.quantity)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-900">{money(r.currentPrice)}</td>
                  <td className="px-3 py-3">
                    <input
                      name={`price_${r.id}`}
                      inputMode="decimal"
                      className="input max-w-40"
                      placeholder={String(r.currentPrice)}
                      value={v}
                      onChange={(e) => setValues((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${changed ? pnlColor(chg) : "text-slate-300"}`}>
                    {changed ? (
                      <>
                        <div className="font-medium">{pct(chg)}</div>
                        <div className="text-xs">{money((n - r.currentPrice) * r.quantity, { sign: true })}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: each asset gets a compact row with the price input full width. */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((r) => {
          const v = values[r.id] ?? "";
          const n = Number(v);
          const changed = v.trim() !== "" && isFinite(n) && n !== r.currentPrice;
          const chg = r.currentPrice > 0 ? (n - r.currentPrice) / r.currentPrice : 0;
          return (
            <li key={r.id} className={`px-4 py-3 ${changed ? "bg-indigo-50/40" : ""}`}>
              <div className="flex items-center gap-2">
                {r.type === "crypto" ? (
                  <CryptoLogo symbol={r.symbol} name={r.name} className="h-7 w-7 rounded-lg" />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_META[r.type].color }} />
                )}
                <Link href={`/assets/${r.id}`} className="min-w-0 font-medium text-slate-900">
                  <span className="block truncate">{r.symbol || r.name}</span>
                  <span className="block truncate text-xs font-normal text-slate-500">{r.name}</span>
                </Link>
                <span className="ml-auto shrink-0 text-right text-xs text-slate-500">
                  {qty(r.quantity)} held
                  <span className="block tabular-nums text-slate-700">{money(r.currentPrice)}</span>
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">New price for {r.symbol || r.name}</span>
                  <input
                    name={`price_${r.id}`}
                    inputMode="decimal"
                    className="input w-full"
                    placeholder={`New price · ${r.currentPrice}`}
                    value={v}
                    onChange={(e) => setValues((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                </label>
                <span className={`w-20 shrink-0 text-right text-xs tabular-nums ${changed ? pnlColor(chg) : "text-slate-300"}`}>
                  {changed ? (
                    <>
                      <span className="block font-medium">{pct(chg)}</span>
                      <span className="block">{money((n - r.currentPrice) * r.quantity, { sign: true })}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                updated {r.updated}
                {r.snapshotsCount ? ` · ${r.snapshotsCount} daily snapshot${r.snapshotsCount === 1 ? "" : "s"}` : ""}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">
          {changes.length ? (
            <>
              {changes.length} change{changes.length > 1 ? "s" : ""} · portfolio impact{" "}
              <span className={`font-semibold ${pnlColor(delta)}`}>{money(delta, { sign: true })}</span>
            </>
          ) : state.ok ? (
            <span className="text-emerald-600">Prices saved ✓</span>
          ) : (
            "Enter new prices — leave blank to keep the current value."
          )}
        </div>
        <div className="flex items-center gap-3">
          <ErrorNote error={state.error} />
          <SubmitButton>Save prices</SubmitButton>
        </div>
      </div>
    </form>
  );
}
