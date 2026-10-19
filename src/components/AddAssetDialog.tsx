"use client";

import { useActionState, useState } from "react";
import { createAsset, type ActionState } from "@/app/actions";
import { ASSET_TYPES, type AssetType } from "@/lib/constants";
import { TYPE_META, money } from "@/lib/format";
import { ErrorNote, Modal, SubmitButton } from "./ui";

export type CashAccount = { id: number; name: string; quantity: number };

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
  const isCash = type === "cash";
  const total = (Number(q) || 0) * (Number(cost) || 0) + (Number(fee) || 0);

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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">{isCash ? "Account name" : "Name"}</label>
          <input name="name" className="input" placeholder={placeholders[type].name} autoFocus />
        </div>
        <div>
          <label className="label">{isCash ? "Currency / tag" : "Symbol / ticker"}</label>
          <input name="symbol" className="input uppercase" placeholder={placeholders[type].symbol} />
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
              <input name="currentPrice" inputMode="decimal" className="input" placeholder="same as buy" />
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
