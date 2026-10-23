"use client";

import { useActionState, useRef, useState } from "react";
import { createAsset, type ActionState } from "@/app/actions";
import { ASSET_TYPES, type AssetType } from "@/lib/constants";
import {
  CEX_PROVIDERS,
  PROVIDER_LABELS,
  type PriceProvider,
} from "@/lib/market-prices";
import type { CryptoCategory } from "@/db/schema";
import { TYPE_META, money } from "@/lib/format";
import { playMoneyChimeFromGesture } from "@/lib/sounds";
import { CAMBODIAN_BANKS, CUSTOM_BANK, type CambodianBank } from "@/lib/cambodian-banks";
import { ErrorNote, Modal, SubmitButton } from "./ui";
import CryptoLogo from "./CryptoLogo";

export type CashAccount = { id: number; name: string; quantity: number };

/** Data source names shown under search results (the API falls back automatically). */
const SEARCH_SOURCE_LABELS: Record<string, string> = {
  coingecko: "CoinGecko",
  coinpaprika: "CoinPaprika",
  dexscreener: "DexScreener",
  binance: "Binance",
};

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
  const [cryptoCategory, setCryptoCategory] = useState<CryptoCategory>("volatile");
  const [priceSource, setPriceSource] = useState<PriceProvider | "">("");
  const [quoteCurrency, setQuoteCurrency] = useState<"USD" | "USDT">("USDT");
  const [quoteState, setQuoteState] = useState<{ status: "idle" | "loading" | "ok" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const [q, setQ] = useState("");
  const [cost, setCost] = useState("");
  const [fee, setFee] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [cryptoQuery, setCryptoQuery] = useState("");
  const [topAssets, setTopAssets] = useState<Array<{
    id: string; name: string; symbol: string; price: number; rank: number | null; chain: string | null; contract: string | null;
  }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [topSource, setTopSource] = useState("");
  const [customBankSelected, setCustomBankSelected] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isCash = type === "cash";
  const total = (Number(q) || 0) * (Number(cost) || 0) + (Number(fee) || 0);
  const selectedBank = CAMBODIAN_BANKS.find((bank) => bank.name === name);
  const isCustomBank = !selectedBank && (customBankSelected || Boolean(name.trim()));
  const activeBank = selectedBank ?? (isCustomBank ? CUSTOM_BANK : undefined);
  const bankSummaryLabel = selectedBank
    ? selectedBank.name
    : isCustomBank
      ? name.trim()
        ? `${CUSTOM_BANK.name} · ${name.trim()}`
        : CUSTOM_BANK.name
      : "Choose a bank";

  async function discoverTopAssets(query = "") {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const response = await fetch(`/api/prices/top${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`);
      const data = (await response.json()) as { error?: string; assets?: typeof topAssets; source?: string };
      if (!response.ok) throw new Error(data.error || "Could not search crypto assets");
      setTopAssets(data.assets || []);
      setTopSource(data.source || "");
      if (query.trim() && !data.assets?.length) setDiscoveryError("No matching crypto asset found. Check the name, symbol, or contract address.");
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : "Could not search crypto assets");
    } finally {
      setDiscovering(false);
    }
  }

  /**
   * Pulls one price from the selected exchange. The dialog has no asset id yet,
   * so it uses the single-quote endpoint instead of the bulk /prices one.
   */
  async function fetchQuote(
    symbolOverride?: string,
    sourceOverride?: PriceProvider | "",
    quoteOverride?: "USD" | "USDT",
  ) {
    const ticker = (symbolOverride ?? symbol).trim();
    const source = sourceOverride ?? priceSource;
    const quote = quoteOverride ?? quoteCurrency;
    if (!ticker) {
      setQuoteState({ status: "error", message: "Type a symbol first, e.g. BTC." });
      return;
    }
    if (!source) {
      setQuoteState({ status: "error", message: "Pick an exchange first, e.g. Binance." });
      return;
    }
    setQuoteState({ status: "loading", message: "" });
    try {
      const params = new URLSearchParams({ symbol: ticker, provider: source, quote });
      const response = await fetch(`/api/prices/quote?${params.toString()}`);
      const data = (await response.json()) as {
        price?: number;
        providerLabel?: string;
        quote?: string;
        error?: string;
      };
      if (!response.ok || typeof data.price !== "number") {
        throw new Error(data.error || "No price returned");
      }
      setCurrentPrice(String(data.price));
      setQuoteState({
        status: "ok",
        message: `${data.providerLabel || PROVIDER_LABELS[source]} · ${data.quote || quote} · ${money(data.price)}`,
      });
    } catch (error) {
      setQuoteState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not fetch a live price",
      });
    }
  }

  function chooseCrypto(asset: (typeof topAssets)[number]) {
    setName(asset.name);
    setSymbol(asset.symbol);
    setCurrentPrice(String(asset.price));
    const stableSymbols = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "PYUSD", "USDD", "FRAX"]);
    setCryptoCategory(stableSymbols.has(asset.symbol.toUpperCase()) ? "stablecoin" : "volatile");
    if (asset.contract) setNotes(`Contract: ${asset.contract}${asset.chain ? ` · Chain: ${asset.chain}` : ""}`);
    // A chosen exchange is more authoritative than the search index's price.
    if (priceSource) void fetchQuote(asset.symbol, priceSource);
    else setQuoteState({ status: "idle", message: "" });
  }

  const placeholders: Record<AssetType, { name: string; symbol: string }> = {
    cash: { name: "e.g. Chase Checking", symbol: "USD" },
    stock: { name: "e.g. Apple Inc.", symbol: "AAPL" },
    crypto: { name: "e.g. Bitcoin", symbol: "BTC" },
    other: { name: "e.g. Gold bar", symbol: "XAU" },
  };

  function playSoundForFundedAsset(event: React.FormEvent<HTMLFormElement>) {
    const quantity = Number(new FormData(event.currentTarget).get("quantity")) || 0;
    if (quantity > 0) playMoneyChimeFromGesture();
  }

  return (
    <form action={action} onSubmit={playSoundForFundedAsset} className="space-y-5">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="cryptoCategory" value={cryptoCategory} />
      <input type="hidden" name="priceSource" value={type === "crypto" ? priceSource : ""} />
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
        <div className="space-y-3">
          <fieldset>
            <legend className="label">Crypto subcategory</legend>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setCryptoCategory("stablecoin")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${cryptoCategory === "stablecoin" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                ◉ Stablecoin
              </button>
              <button
                type="button"
                onClick={() => setCryptoCategory("volatile")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${cryptoCategory === "volatile" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                ◆ Volatile asset
              </button>
            </div>
          </fieldset>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Find any crypto asset</p>
            <p className="text-xs text-slate-500">Search by name, ticker, or token contract address across CEX and DEX markets.</p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
              </svg>
              <input
                className="input pl-9"
                value={cryptoQuery}
                onChange={(event) => setCryptoQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void discoverTopAssets(cryptoQuery); }
                }}
                placeholder="Bitcoin, BTC, or 0x contract…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button type="button" className="btn-primary shrink-0" onClick={() => void discoverTopAssets(cryptoQuery)} disabled={discovering || !cryptoQuery.trim()}>
              {discovering ? "Searching…" : "Search"}
            </button>
            <button type="button" className="btn-ghost shrink-0" onClick={() => { setCryptoQuery(""); void discoverTopAssets(""); }} disabled={discovering}>
              Top assets
            </button>
          </div>
          {discoveryError && <p className="mt-2 text-xs text-rose-600">{discoveryError}</p>}
          {topSource && !discoveryError && (
            <p className="mt-2 text-xs text-slate-400">
              Prices via {SEARCH_SOURCE_LABELS[topSource] ?? topSource} · switches provider automatically when one is rate-limited
            </p>
          )}
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
                  <span className="flex items-center gap-2">
                    <CryptoLogo symbol={asset.symbol} name={asset.name} className="h-8 w-8 rounded-lg" />
                    <span>
                      <span className="block text-[10px] text-slate-400">#{asset.rank || "—"}</span>
                      <span className="block font-semibold text-slate-900">{asset.symbol}</span>
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{money(asset.price)}</span>
                  {asset.chain && <span className="mt-0.5 block max-w-28 truncate text-[10px] capitalize text-slate-400">{asset.chain} · contract</span>}
                </button>
              ))}
            </div>
          )}
          </div>

          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1">
                <label className="label" htmlFor="priceSourcePicker">
                  Price from
                </label>
                <select
                  id="priceSourcePicker"
                  className="input"
                  value={priceSource}
                  onChange={(event) => {
                    const next = event.target.value as PriceProvider | "";
                    setPriceSource(next);
                    setQuoteState({ status: "idle", message: "" });
                  }}
                >
                  <option value="">Auto — any exchange</option>
                  {CEX_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="label" htmlFor="quoteCurrency">
                  Quote
                </label>
                <select
                  id="quoteCurrency"
                  className="input"
                  value={quoteCurrency}
                  onChange={(event) => {
                    const next = event.target.value as "USD" | "USDT";
                    setQuoteCurrency(next);
                    setQuoteState({ status: "idle", message: "" });
                    if (priceSource && symbol.trim()) void fetchQuote(symbol, priceSource, next);
                  }}
                >
                  <option value="USDT">USDT</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void fetchQuote()}
                disabled={quoteState.status === "loading"}
              >
                {quoteState.status === "loading" ? "Fetching…" : "Fetch live price"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Saved with the holding, so background refreshes keep pricing it from the same exchange. Public
              tickers only — no API keys. Auto tries every exchange.
            </p>
            {quoteState.status === "error" && (
              <p className="mt-1 text-xs font-medium text-rose-600">{quoteState.message}</p>
            )}
            {quoteState.status === "ok" && (
              <p className="mt-1 text-xs font-medium text-emerald-600">{quoteState.message}</p>
            )}
          </div>
        </div>
      )}

      {isCash && (
        <div>
          <label className="label">Cambodian bank</label>
          <details className="bank-picker relative">
            <summary className="input flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {activeBank ? <BankLogo bank={activeBank} small /> : <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-xs">🏦</span>}
                <span className={activeBank ? "truncate text-slate-900" : "text-slate-400"}>
                  {bankSummaryLabel}
                </span>
              </span>
              <span className="text-xs text-slate-400">▼</span>
            </summary>
            <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {CAMBODIAN_BANKS.map((bank) => (
                  <button
                    key={bank.name}
                    type="button"
                    className={`flex items-center gap-2 rounded-xl p-2 text-left text-sm transition hover:bg-slate-50 ${!isCustomBank && name === bank.name ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700"}`}
                    onClick={(event) => {
                      setCustomBankSelected(false);
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
              <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-xl p-2 text-left text-sm transition hover:bg-slate-50 ${isCustomBank ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700"}`}
                  onClick={(event) => {
                    setCustomBankSelected(true);
                    if (selectedBank) setName("");
                    if (!symbol) setSymbol("USD");
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    requestAnimationFrame(() => nameInputRef.current?.focus());
                  }}
                >
                  <BankLogo bank={CUSTOM_BANK} small />
                  <span>{CUSTOM_BANK.name}</span>
                  <span className="ml-auto text-xs font-normal text-slate-400">Type any bank name</span>
                </button>
              </div>
            </div>
          </details>
          <p className="mt-1 text-xs text-slate-400">Choose a bank or enter a custom account name below.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">{isCash ? "Account name" : "Name"}</label>
          {isCash && isCustomBank && !name.trim() && (
            <input type="hidden" name="name" value={CUSTOM_BANK.name} />
          )}
          <input
            ref={nameInputRef}
            name={isCash && isCustomBank && !name.trim() ? undefined : "name"}
            className="input"
            placeholder={isCash && isCustomBank ? "Enter custom bank or account name" : placeholders[type].name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">{isCash ? "Currency / tag" : "Symbol / ticker"}</label>
          <input name="symbol" className="input uppercase" placeholder={placeholders[type].symbol} value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
          {type === "stock" && (
            <p className="mt-1 text-xs text-slate-400">
              Use the Yahoo Finance symbol — e.g. AAPL, VOO, BRK-B, 7203.T. Quotes are converted to USD automatically.
            </p>
          )}
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
        <textarea name="notes" rows={2} className="input" placeholder="Optional — broker, wallet, strategy…" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      <ErrorNote error={state.error} />
      <div className="flex justify-end">
        <SubmitButton>Add {TYPE_META[type].label.replace(/s$/, "").toLowerCase()}</SubmitButton>
      </div>
    </form>
  );
}
