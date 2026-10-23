"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addTransaction, updateAsset, updatePrice, type ActionState } from "@/app/actions";
import type { AssetType, TxKind } from "@/lib/constants";
import { CEX_PROVIDERS, PROVIDER_LABELS, type PriceProvider } from "@/lib/market-prices";
import { KIND_META, kindsFor, money, qty } from "@/lib/format";
import { playMoneyChime } from "@/lib/sounds";
import { WEB3_WALLETS, type Web3WalletId } from "@/lib/web3-wallets";
import type { CashAccount } from "./AddAssetDialog";
import { ErrorNote, Modal, SubmitButton } from "./ui";

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function TransactionForm({
  assetId,
  assetType,
  currentPrice,
  available,
  cashAccounts,
}: {
  assetId: number;
  assetType: AssetType;
  currentPrice: number;
  available: number;
  cashAccounts: CashAccount[];
}) {
  const kinds = kindsFor(assetType);
  const [kind, setKind] = useState<TxKind>(kinds[0]);
  const [q, setQ] = useState("");
  const [price, setPrice] = useState(currentPrice ? String(currentPrice) : "");
  const [fee, setFee] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const submittedKind = fd.get("kind");
    const result = await addTransaction(prev, fd);
    if (result.ok) {
      setQ("");
      setFee("");
      const note = formRef.current?.querySelector<HTMLInputElement>("input[name=note]");
      if (note) note.value = "";
      if (submittedKind === "deposit" && audioRef.current) {
        void audioRef.current.resume().then(() => playMoneyChime(audioRef.current!));
      }
    }
    return result;
  }, {});

  function prepareTransactionFeedback() {
    if (kind !== "deposit") return;

    // Creating/resuming the context during the submit gesture keeps sound working on iOS.
    audioRef.current ??= new AudioContext();
    void audioRef.current.resume();
  }

  const isCash = assetType === "cash";
  const isIncome = kind === "dividend";
  const showPrice = !isCash && !isIncome;
  const gross = showPrice ? (Number(q) || 0) * (Number(price) || 0) : Number(q) || 0;
  const feeN = Number(fee) || 0;
  const total = kind === "buy" ? gross + feeN : gross - feeN;
  const canDrawDown = kind === "sell" || kind === "withdraw";

  return (
    <form ref={formRef} action={action} onSubmit={prepareTransactionFeedback} className="space-y-4">
      <input type="hidden" name="assetId" value={assetId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {KIND_META[k].label}
          </button>
        ))}
      </div>

      <div className={`grid gap-3 ${showPrice ? "grid-cols-2" : "grid-cols-1"}`}>
        <div>
          <label className="label flex justify-between">
            <span>{isIncome || isCash ? "Amount" : "Quantity"}</span>
            {canDrawDown && (
              <button
                type="button"
                className="normal-case tracking-normal text-indigo-600 hover:underline"
                onClick={() => setQ(String(+available.toFixed(10)))}
              >
                Max {qty(available)}
              </button>
            )}
          </label>
          <input
            name={isIncome ? "amount" : "quantity"}
            inputMode="decimal"
            className="input"
            placeholder="0"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            required
          />
        </div>
        {showPrice && (
          <div>
            <label className="label">Price per unit</label>
            <input
              name="price"
              inputMode="decimal"
              className="input"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
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
          <label className="label">Date</label>
          <input name="date" type="date" className="input" defaultValue={todayStr()} />
        </div>
      </div>

      {!isCash && cashAccounts.length > 0 && (
        <div>
          <label className="label">{kind === "buy" ? "Pay from cash" : "Deposit proceeds to"}</label>
          <select name="cashAccountId" className="input" defaultValue="">
            <option value="">None — don&apos;t link</option>
            {cashAccounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({money(c.quantity)})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label">Note</label>
        <input name="note" className="input" placeholder="Optional" />
      </div>

      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <span className="text-slate-500">
          {kind === "buy" ? "Total cost" : kind === "sell" ? "Net proceeds" : "Net amount"}
        </span>
        <span className="font-semibold text-slate-900">{money(total)}</span>
      </div>

      <ErrorNote error={state.error} />
      {state.ok && !state.error && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
          Transaction recorded.
        </p>
      )}
      <SubmitButton className="btn-primary w-full">Record {KIND_META[kind].label.toLowerCase()}</SubmitButton>
    </form>
  );
}

export function PriceForm({ assetId, currentPrice }: { assetId: number; currentPrice: number }) {
  const [state, action] = useActionState<ActionState, FormData>(updatePrice, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={assetId} />
      <div className="flex gap-2">
        <input
          key={currentPrice}
          name="price"
          inputMode="decimal"
          className="input"
          defaultValue={currentPrice || ""}
          placeholder="New price"
          required
        />
        <SubmitButton className="btn-primary shrink-0" pendingText="…">
          Update
        </SubmitButton>
      </div>
      <ErrorNote error={state.error} />
    </form>
  );
}

export function EditAssetButton({
  asset,
}: {
  asset: {
    id: number;
    name: string;
    symbol: string;
    notes: string;
    type: AssetType;
    cryptoCategory: "stablecoin" | "volatile";
    priceSource: PriceProvider | "";
    walletLogo?: Web3WalletId | "";
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit details">
        {open && <EditAssetForm asset={asset} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function EditAssetForm({
  asset,
  onDone,
}: {
  asset: {
    id: number;
    name: string;
    symbol: string;
    notes: string;
    type: AssetType;
    cryptoCategory: "stablecoin" | "volatile";
    priceSource: PriceProvider | "";
    walletLogo?: Web3WalletId | "";
  };
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateAsset, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ts, state.ok, onDone]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={asset.id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" className="input" defaultValue={asset.name} />
        </div>
        <div>
          <label className="label">Symbol</label>
          <input name="symbol" className="input uppercase" defaultValue={asset.symbol} />
        </div>
      </div>
      {asset.type === "crypto" && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Crypto subcategory</label>
              <select name="cryptoCategory" className="input" defaultValue={asset.cryptoCategory}>
                <option value="stablecoin">Stablecoin</option>
                <option value="volatile">Volatile asset</option>
              </select>
            </div>
            <div>
              <label className="label">Price from</label>
              <select name="priceSource" className="input" defaultValue={asset.priceSource}>
                <option value="">Auto — any exchange</option>
                {CEX_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Logo / Web3 wallet</label>
            <select name="walletLogo" className="input" defaultValue={asset.walletLogo ?? ""}>
              <option value="">Token logo (auto from symbol)</option>
              {WEB3_WALLETS.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div>
        <label className="label">Notes</label>
        <textarea name="notes" rows={3} className="input" defaultValue={asset.notes} />
      </div>
      <ErrorNote error={state.error} />
      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}
