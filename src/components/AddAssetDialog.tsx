"use client";

import { useActionState, useState } from "react";
import { createAsset, type ActionState } from "@/app/actions";
import { ASSET_TYPES, type AssetType } from "@/lib/constants";
import { TYPE_META, money } from "@/lib/format";
import { CAMBODIAN_BANKS, type CambodianBank } from "@/lib/cambodian-banks";
import { ErrorNote, Modal, SubmitButton } from "./ui";

export type CashAccount = { id: number; name: string; quantity: number };

function BankLogo({ bank, small = false }: { bank: CambodianBank; small?: boolean }) {
  return (
    <span
      className={`${small ? "h-7 w-7 text-[8px]" : "h-9 w-9 text-[10px]"} grid shrink-0 place-items-center rounded-lg font-bold text-white shadow-sm`}
      style={{ backgroundColor: bank.color }}
      aria-hidden="true"
    >
      {bank.short}
    </span>
  );
}

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function AddAssetDialog({
  cashAccounts,
  defaultType = "stock",
  label = "+ Add asset",
  className = "btn-primary",
}: {
  cashAccounts: CashAccount[];
  defaultType?: AssetType;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add holding" wide>
        {open && <AddAssetForm cashAccounts={cashAccounts} defaultType={defaultType} />}
      </Modal>
    </>
  );
}

function AddAssetForm({ cashAccounts, defaultType }: { cashAccounts: CashAccount[]; defaultType: AssetType }) {
  const [state, action] = useActionState<ActionState, FormData>(createAsset, {});
  const [type, setType] = useState<AssetType>(defaultType);
  const [q, setQ] = useState("");
  const [cost, setCost] = useState("");
  const [fee, setFee] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [topAssets, setTopAssets] = useState<Array<{ id: string; name: string; symbol: string; price: number; rank: number | null }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const isCash = type === "cash";
  const total = (Number(q) || 0) * (Number(cost) || 0) + (Number(fee) || 0);
  const selectedBank = CAMBODIAN_BANKS.find((bank) => bank.name === name);

  async function discoverTopAssets() {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const response = await fetch("/api/prices/top");
      const data = (await response.json()) as { error?: string; assets?: typeof topAssets };
      if (!response.ok) throw new Error(data.error || "Could not load top assets");
      setTopAssets(data.assets || []);
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : "Could not load top assets");
    } finally {
      setDiscovering(false);
    }
  }

  function chooseCrypto(asset: (typeof topAssets)[number]) {
    setName(asset.name);
    setSymbol(asset.symbol);
    setCurrentPrice(String(asset.price));
  }

  const placeholders: Record<AssetType, { name: string; symbol: string }> = {
    cash: { name: "e.g. Chase Checking", symbol: "USD" },
    stock: { name: "e.g. Apple Inc.", symbol: "AAPL" },
    crypto: { name: "e.g. Bitcoin", symbol: "BTC" },
    other: { name: "e.g. Gold bar", symbol: "XAU" },
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="type" value={type} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ASSET_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-3 text-sm font-medium transition ${
              type === t
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-4 ring-indigo-100"
                : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            <span className="text-xl">{TYPE_META[t].icon}</span>
            {TYPE_META[t].label}
          </button>
        ))}
      </div>

      {type === "crypto" && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Find a top crypto asset</p>
              <p className="text-xs text-slate-500">Live market ranking and USD price. No API key is required.</p>
            </div>
            <button type="button" className="btn-ghost shrink-0" onClick={discoverTopAssets} disabled={discovering}>
              {discovering ? "Loading…" : topAssets.length ? "Refresh" : "Show top assets"}
            </button>
          </div>
          {discoveryError && <p className="mt-2 text-xs text-rose-600">{discoveryError}</p>}
          {topAssets.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {topAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => chooseCrypto(asset)}
                  className={`min-w-24 rounded-xl border px-3 py-2 text-left transition ${
                    symbol === asset.symbol ? "border-indigo-500 bg-white ring-2 ring-indigo-100" : "border-slate-200 bg-white hover:border-indigo-300"
                  }`}
                >
                  <span className="block text-xs text-slate-400">#{asset.rank || "—"}</span>
                  <span className="block font-semibold text-slate-900">{asset.symbol}</span>
                  <span className="block text-xs text-slate-500">{money(asset.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isCash && (
        <div>
          <label className="label">Cambodian bank</label>
          <details className="bank-picker relative">
            <summary className="input flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {selectedBank ? <BankLogo bank={selectedBank} small /> : <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-xs">🏦</span>}
                <span className={selectedBank ? "truncate text-slate-900" : "text-slate-400"}>
                  {selectedBank?.name || "Choose a bank"}
                </span>
              </span>
              <span className="text-xs text-slate-400">▼</span>
            </summary>
            <div className="absolute z-30 mt-2 grid max-h-72 w-full grid-cols-1 gap-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl sm:grid-cols-2">
              {CAMBODIAN_BANKS.map((bank) => (
                <button
                  key={bank.name}
                  type="button"
                  className={`flex items-center gap-2 rounded-xl p-2 text-left text-sm transition hover:bg-slate-50 ${name === bank.name ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700"}`}
                  onClick={(event) => {
                    setName(bank.name);
                    setSymbol("USD");
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  <BankLogo bank={bank} small />
                  <span>{bank.name}</span>
                </button>
              ))}
            </div>
          </details>
          <p className="mt-1 text-xs text-slate-400">Choose a bank or enter a custom account name below.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">{isCash ? "Account name" : "Name"}</label>
          <input name="name" className="input" placeholder={placeholders[type].name} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">{isCash ? "Currency / tag" : "Symbol / ticker"}</label>
          <input name="symbol" className="input uppercase" placeholder={placeholders[type].symbol} value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
        </div>
      </div>

      {isCash ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Balance</label>
            <input name="quantity" inputMode="decimal" className="input" placeholder="0.00" />
          </div>
          <div>
            <label className="label">As of date</label>
            <input name="date" type="date" className="input" defaultValue={todayStr()} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Quantity</label>
              <input
                name="quantity"
                inputMode="decimal"
                className="input"
                placeholder="0"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Avg. buy price</label>
              <input
                name="avgCost"
                inputMode="decimal"
                className="input"
                placeholder="0.00"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Current price</label>
              <input
                name="currentPrice"
                inputMode="decimal"
                className="input"
                placeholder="same as buy"
                value={currentPrice}
                onChange={(event) => setCurrentPrice(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Fee</label>
              <input
                name="fee"
                inputMode="decimal"
                className="input"
                placeholder="0.00"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Purchase date</label>
              <input name="date" type="date" className="input" defaultValue={todayStr()} />
            </div>
            <div>
              <label className="label">Pay from cash</label>
              <select name="cashAccountId" className="input" defaultValue="">
                <option value="">Don&apos;t deduct</option>
                {cashAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({money(c.quantity)})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-500">Total cost basis</span>
            <span className="font-semibold text-slate-900">{money(total)}</span>
          </div>
        </>
      )}

      <div>
        <label className="label">Notes</label>
        <textarea name="notes" rows={2} className="input" placeholder="Optional — broker, wallet, strategy…" />
      </div>

      <ErrorNote error={state.error} />
      <div className="flex justify-end">
        <SubmitButton>Add {TYPE_META[type].label.replace(/s$/, "").toLowerCase()}</SubmitButton>
      </div>
    </form>
  );
}
