"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useRef, useState } from "react";
import { createAsset, importWalletBalances, type ActionState } from "@/app/actions";
import { ASSET_TYPES, type AssetType } from "@/lib/constants";
import {
  CEX_PROVIDERS,
  PROVIDER_LABELS,
  type PriceProvider,
} from "@/lib/market-prices";
import type { CryptoCategory } from "@/db/schema";
import { TYPE_META, money, qty } from "@/lib/format";
import { playMoneyChimeFromGesture } from "@/lib/sounds";
import { DEFAULT_DUST_THRESHOLD_USD, normaliseDustThreshold } from "@/lib/wallet-dust";
import { MIN_ORGANIC_VOLUME_USD, shortUsd } from "@/lib/organic-volume";
import { filterScanBalances } from "@/lib/wallet-trust";
import { CAMBODIAN_BANKS, CUSTOM_BANK, type CambodianBank } from "@/lib/cambodian-banks";
import type { DiscoveredStock } from "@/lib/stock-search";
import {
  WALLET_CHAINS,
  WALLET_CHAIN_LABELS,
  canonicalChainId,
  shortWalletAddress,
  type ScannedWalletBalance,
} from "@/lib/wallet-scanner";
import {
  WEB3_WALLETS,
  getWeb3Wallet,
  type Web3WalletId,
} from "@/lib/web3-wallets";
import { ErrorNote, Modal, SubmitButton } from "./ui";
import CryptoLogo, { Web3WalletBadge } from "./CryptoLogo";

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
        {open && (
          <AddAssetForm
            cashAccounts={cashAccounts}
            defaultType={defaultType}
            onDone={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

function AddAssetForm({
  cashAccounts,
  defaultType,
  onDone,
}: {
  cashAccounts: CashAccount[];
  defaultType: AssetType;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ActionState, FormData>(createAsset, {});
  const [type, setType] = useState<AssetType>(defaultType);
  const [cryptoCategory, setCryptoCategory] = useState<CryptoCategory>("volatile");
  const [walletLogo, setWalletLogo] = useState<Web3WalletId | "">("");
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
  const [stockQuery, setStockQuery] = useState("");
  const [stockResults, setStockResults] = useState<DiscoveredStock[]>([]);
  const [scanningStocks, setScanningStocks] = useState(false);
  const [stockScanError, setStockScanError] = useState("");
  const [stockSource, setStockSource] = useState("");
  const [stockQuoteState, setStockQuoteState] = useState<{
    status: "idle" | "loading" | "ok" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const [walletAddress, setWalletAddress] = useState("");
  const [walletChain, setWalletChain] = useState("auto");
  const [walletBalances, setWalletBalances] = useState<ScannedWalletBalance[]>([]);
  const [scanningWallet, setScanningWallet] = useState(false);
  const [walletScanError, setWalletScanError] = useState("");
  const [walletScanDone, setWalletScanDone] = useState(false);
  const [walletScanSource, setWalletScanSource] = useState<"debank" | "onchain" | null>(null);
  const [walletScanNote, setWalletScanNote] = useState("");
  const [importingWallet, setImportingWallet] = useState(false);
  /** Import the wallet's tokens into a folder, named by the user or by the address. */
  const [walletFileIntoFolder, setWalletFileIntoFolder] = useState(true);
  const [walletFolderName, setWalletFolderName] = useState("");
  /** Hide scanned balances worth less than `walletDustThreshold` (dust). */
  const [walletHideDust, setWalletHideDust] = useState(true);
  const [walletDustThreshold, setWalletDustThreshold] = useState(
    String(DEFAULT_DUST_THRESHOLD_USD),
  );
  /** Hide tokens that look like airdropped spam (ads, fake tickers). */
  const [walletHideSpam, setWalletHideSpam] = useState(true);
  /** Hide tokens whose contract is not the official one for their symbol. */
  const [walletHideImpostor, setWalletHideImpostor] = useState(true);
  /** Hide tokens nobody trades (unknown volume is always kept). */
  const [walletRequireMarket, setWalletRequireMarket] = useState(true);
  /**
   * Tokens the user unticked. Kept as a set of *exclusions* rather than a set of
   * picks, so changing a filter never silently re-selects something they dropped.
   */
  const [walletDeselected, setWalletDeselected] = useState<Set<string>>(new Set());
  const [walletImportMessage, setWalletImportMessage] = useState("");
  const [customBankSelected, setCustomBankSelected] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isCash = type === "cash";
  /**
   * The chain filter: the built-in chains this app can also read directly, plus
   * every other chain the last scan found — DeBank indexes far more chains than
   * the app lists by hand, and a wallet holding one of them should still be
   * filterable by it.
   */
  const walletChainOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    const options = WALLET_CHAINS.map((chain) => ({
      value: chain as string,
      label: WALLET_CHAIN_LABELS[chain],
    }));
    const seen = new Set(WALLET_CHAINS.map((chain) => canonicalChainId(chain)));
    for (const item of walletBalances) {
      const key = canonicalChainId(item.chain);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ value: item.chain, label: item.chainLabel });
    }
    return options;
  }, [walletBalances]);

  /** How many distinct chains the last scan found balances on. */
  const walletScanChainCount = new Set(walletBalances.map((item) => item.chain)).size;

  const walletDustCut = walletHideDust ? normaliseDustThreshold(walletDustThreshold) : 0;
  /**
   * What is worth importing, in order of how sure the app is: the right
   * contract, not airdrop bait, a real market, and worth more than the cut-off.
   * Every bucket is counted and can be shown again — this is a filter, not a
   * delete.
   */
  const walletSelection = useMemo(
    () =>
      filterScanBalances(walletBalances, {
        hideSpam: walletHideSpam,
        dustCut: walletDustCut,
        hideImpostor: walletHideImpostor,
        requireMarket: walletRequireMarket,
      }),
    [walletBalances, walletHideSpam, walletDustCut, walletHideImpostor, walletRequireMarket],
  );
  const walletVisibleBalances = walletSelection.kept;
  /** What "Import selected" imports: the kept tokens the user left ticked. */
  const walletChosen = walletVisibleBalances.filter((item) => !walletDeselected.has(item.id));
  const walletChosenIds = new Set(walletChosen.map((item) => item.id));
  /** Folder the scan would be filed into; blank means "name it after the address". */
  const walletFolderPlaceholder = shortWalletAddress(walletAddress.trim()) || "0x1234…abcd";
  const walletFolderLabel = walletFolderName.trim() || walletFolderPlaceholder;
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

  async function discoverStocks(query = "") {
    setScanningStocks(true);
    setStockScanError("");
    try {
      const response = await fetch(
        `/api/prices/stocks${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`,
      );
      const data = (await response.json()) as {
        error?: string;
        assets?: DiscoveredStock[];
        source?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not scan stock assets");
      setStockResults(data.assets || []);
      setStockSource(data.source || "");
      if (query.trim() && !data.assets?.length) {
        setStockScanError("No matching stock or ETF found. Try a ticker like AAPL, NVDA, VOO, or 7203.T.");
      }
    } catch (error) {
      setStockScanError(error instanceof Error ? error.message : "Could not scan stock assets");
    } finally {
      setScanningStocks(false);
    }
  }

  async function fetchSingleStockQuote(symbolOverride?: string) {
    const ticker = (symbolOverride ?? symbol).trim();
    if (!ticker) {
      setStockQuoteState({ status: "error", message: "Type or pick a stock symbol first, e.g. AAPL." });
      return;
    }
    setStockQuoteState({ status: "loading", message: "" });
    try {
      const response = await fetch(
        `/api/prices/stocks?symbol=${encodeURIComponent(ticker)}`,
      );
      const data = (await response.json()) as {
        price?: number;
        exchange?: string;
        currency?: string;
        error?: string;
      };
      if (!response.ok || typeof data.price !== "number") {
        throw new Error(data.error || "Could not fetch a live quote");
      }
      setCurrentPrice(String(data.price));
      setStockQuoteState({
        status: "ok",
        message: `Yahoo Finance${data.exchange ? ` · ${data.exchange}` : ""} · USD · ${money(data.price)}`,
      });
    } catch (error) {
      setStockQuoteState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not fetch a live stock quote",
      });
    }
  }

  function chooseStock(stock: DiscoveredStock) {
    setName(stock.name);
    setSymbol(stock.symbol);
    if (stock.price !== null && stock.price > 0) {
      setCurrentPrice(String(stock.price));
      setStockQuoteState({
        status: "ok",
        message: `${stock.exchange || "Yahoo Finance"} · USD · ${money(stock.price)}`,
      });
    } else {
      setStockQuoteState({ status: "idle", message: "" });
      void fetchSingleStockQuote(stock.symbol);
    }
  }

  async function scanWallet() {
    const trimmed = walletAddress.trim();
    if (!trimmed) {
      setWalletScanError("Paste a wallet address first (0x…, Solana, bc1…, or T…).");
      return;
    }
    setScanningWallet(true);
    setWalletScanError("");
    setWalletImportMessage("");
    setWalletScanDone(false);
    try {
      const params = new URLSearchParams({ address: trimmed, chain: walletChain });
      const response = await fetch(`/api/wallet/scan?${params.toString()}`);
      const data = (await response.json()) as {
        error?: string;
        balances?: ScannedWalletBalance[];
        source?: "debank" | "onchain";
        sourceNote?: string;
        debankNeedsKey?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not scan that wallet address.");
      }
      const list = data.balances || [];
      setWalletBalances(list);
      // A new scan starts with everything ticked again.
      setWalletDeselected(new Set());
      setWalletScanDone(true);
      setWalletScanSource(data.source ?? null);
      // Only mention DeBank when it was actually involved, so the picker stays
      // quiet on a plain on-chain read for Solana / Bitcoin / Tron.
      // Where the numbers came from, said plainly. DeBank being unavailable is
      // a smaller scan, not an error — and when the cause is a missing key, the
      // note says so once and names the fix.
      setWalletScanNote(
        data.source !== "onchain"
          ? ""
          : data.debankNeedsKey
            ? "Read directly from the chains — DeBank only lists tokens with an access key, so this scan sees fewer of them. Add a free DEBANK_ACCESS_KEY to cover every chain DeBank indexes."
            : data.sourceNote
              ? `Read directly from the chains — ${data.sourceNote}`
              : "",
      );
      if (list.length === 0) {
        setWalletScanError("No non-zero balances found on that wallet address.");
      } else if (list.length === 1) {
        chooseWalletBalance(list[0], trimmed);
      }
    } catch (error) {
      setWalletScanError(
        error instanceof Error ? error.message : "Could not scan that wallet address.",
      );
    } finally {
      setScanningWallet(false);
    }
  }

  function chooseWalletBalance(item: ScannedWalletBalance, addrOverride?: string) {
    const addr = (addrOverride ?? walletAddress).trim();
    const shortAddr = addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
    setName(item.name);
    setSymbol(item.symbol);
    setQ(String(item.quantity));
    if (item.price > 0) {
      setCurrentPrice(String(item.price));
      setCost(String(item.price));
    }
    setCryptoCategory(item.category);
    setNotes(
      `Wallet: ${addr}${shortAddr ? ` (${shortAddr})` : ""} · Chain: ${item.chainLabel}${
        item.contract ? ` · Contract: ${item.contract}` : ""
      }`,
    );
  }

  /** Ticks or unticks one token without touching the form. */
  function toggleWalletChoice(id: string) {
    setWalletDeselected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Tick every visible token (after the user unticked some). */
  function selectAllWalletBalances() {
    setWalletDeselected(new Set());
  }

  /** Untick every visible token. */
  function selectNoWalletBalances() {
    setWalletDeselected(new Set(walletVisibleBalances.map((item) => item.id)));
  }

  async function handleImportAllWalletBalances() {
    if (walletChosen.length === 0) return;
    setImportingWallet(true);
    setWalletScanError("");
    setWalletImportMessage("");
    try {
      const result = await importWalletBalances({
        address: walletAddress.trim(),
        walletLogo,
        priceSource,
        folderName: walletFileIntoFolder ? walletFolderName.trim() : null,
        // The server applies the same rules, so a stale client cannot slip
        // dust or spam into the portfolio.
        minValueUsd: walletDustCut,
        skipSpam: walletHideSpam,
        skipImpostor: walletHideImpostor,
        minOrganicVolumeUsd: walletRequireMarket ? MIN_ORGANIC_VOLUME_USD : 0,
        balances: walletChosen.map((item) => ({ ...item, chain: item.chain })),
      });
      if (!result.ok) {
        throw new Error(result.error || "Could not import wallet balances.");
      }
      playMoneyChimeFromGesture();
      const count = `${result.importedCount} holding${result.importedCount === 1 ? "" : "s"}`;
      const skipped = [
        result.skippedDust ? `Skipped ${result.skippedDust} under ${money(walletDustCut)}.` : "",
        result.skippedSpam ? `Skipped ${result.skippedSpam} that looked like spam.` : "",
        result.skippedImpostor
          ? `Skipped ${result.skippedImpostor} with the wrong contract address.`
          : "",
        result.skippedThin ? `Skipped ${result.skippedThin} with no trading volume.` : "",
      ]
        .filter(Boolean)
        .map((note) => ` ${note}`)
        .join("");
      if (result.folder) {
        setWalletImportMessage(
          `Imported ${count} into the “${result.folder.name}” folder.${skipped}`,
        );
        setWalletFolderName("");
      } else {
        setWalletImportMessage(
          result.folderNote
            ? `Imported ${count}. ${result.folderNote}${skipped}`
            : `Imported ${count} from wallet.${skipped}`,
        );
      }
      router.refresh();
      onDone?.();
    } catch (error) {
      setWalletScanError(
        error instanceof Error ? error.message : "Could not import wallet balances.",
      );
    } finally {
      setImportingWallet(false);
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

  const selectedWallet = getWeb3Wallet(walletLogo);

  function selectWeb3Wallet(nextWalletId: Web3WalletId | "") {
    setWalletLogo(nextWalletId);
    if (!nextWalletId) return;
    const picked = getWeb3Wallet(nextWalletId);
    if (!picked) return;
    const trimmedName = name.trim();
    const isAnotherWalletName = WEB3_WALLETS.some(
      (w) => w.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (!trimmedName || isAnotherWalletName) {
      setName(picked.name);
    }
  }

  return (
    <form action={action} onSubmit={playSoundForFundedAsset} className="space-y-5">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="cryptoCategory" value={cryptoCategory} />
      <input type="hidden" name="priceSource" value={type === "crypto" ? priceSource : ""} />
      <input type="hidden" name="walletLogo" value={type === "crypto" ? walletLogo : ""} />
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

      {type === "stock" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Find any stock or ETF</p>
                <p className="text-xs text-slate-500">
                  Scan by company name or ticker across US &amp; international markets (e.g. Apple, AAPL, NVDA, VOO, 7203.T).
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void fetchSingleStockQuote()}
                disabled={stockQuoteState.status === "loading"}
              >
                {stockQuoteState.status === "loading" ? "Fetching…" : "Fetch live quote"}
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  className="input pl-9"
                  value={stockQuery}
                  onChange={(event) => setStockQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void discoverStocks(stockQuery);
                    }
                  }}
                  placeholder="Apple, AAPL, NVDA, S&P 500, VOO, 7203.T…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                className="btn-primary shrink-0"
                onClick={() => void discoverStocks(stockQuery)}
                disabled={scanningStocks || !stockQuery.trim()}
              >
                {scanningStocks ? "Scanning…" : "Scan"}
              </button>
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={() => {
                  setStockQuery("");
                  void discoverStocks("");
                }}
                disabled={scanningStocks}
              >
                Top stocks
              </button>
            </div>
            {stockScanError && <p className="mt-2 text-xs text-rose-600">{stockScanError}</p>}
            {stockSource && !stockScanError && (
              <p className="mt-2 text-xs text-slate-400">
                {stockSource === "yahoo"
                  ? "Live quotes via Yahoo Finance · converted to USD automatically"
                  : "Matched from built-in stock & ETF directory · select an asset to load its quote"}
              </p>
            )}
            {stockQuoteState.status === "error" && (
              <p className="mt-2 text-xs font-medium text-rose-600">{stockQuoteState.message}</p>
            )}
            {stockQuoteState.status === "ok" && (
              <p className="mt-2 text-xs font-medium text-emerald-600">{stockQuoteState.message}</p>
            )}
            {stockResults.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {stockResults.map((stock) => (
                  <button
                    key={stock.symbol}
                    type="button"
                    onClick={() => chooseStock(stock)}
                    className={`min-w-32 rounded-xl border px-3 py-2 text-left transition ${
                      symbol === stock.symbol
                        ? "border-indigo-500 bg-white ring-2 ring-indigo-100"
                        : "border-slate-200 bg-white hover:border-indigo-300"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white"
                        style={{ background: TYPE_META.stock.color }}
                      >
                        {stock.symbol.slice(0, 4)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] text-slate-400">
                          {stock.kind}
                          {stock.exchange ? ` · ${stock.exchange}` : ""}
                        </span>
                        <span className="block truncate font-semibold text-slate-900">
                          {stock.symbol}
                        </span>
                      </span>
                    </span>
                    <span className="mt-1 block max-w-36 truncate text-xs text-slate-600">
                      {stock.name}
                    </span>
                    <span className="mt-0.5 block text-xs font-medium text-slate-500">
                      {stock.price !== null ? money(stock.price) : "Tap to quote"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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

          <div>
            <label className="label">Logo / Web3 wallet</label>
            <details className="bank-picker relative">
              <summary className="input flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <CryptoLogo
                    symbol={symbol || "BTC"}
                    name={name || "Token"}
                    wallet={walletLogo}
                    className="h-7 w-7 rounded-lg"
                  />
                  <span className="truncate text-slate-900">
                    {selectedWallet
                      ? `${selectedWallet.name} (Web3 wallet logo)`
                      : "Token logo (auto from symbol)"}
                  </span>
                </span>
                <span className="text-xs text-slate-400">▼</span>
              </summary>
              <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button
                  type="button"
                  className={`mb-1.5 flex w-full items-center gap-2 rounded-xl p-2 text-left text-sm transition hover:bg-slate-50 ${
                    !walletLogo ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700"
                  }`}
                  onClick={(event) => {
                    selectWeb3Wallet("");
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  <CryptoLogo
                    symbol={symbol || "BTC"}
                    name={name || "Token"}
                    className="h-7 w-7 rounded-lg"
                  />
                  <span>Token logo (auto from symbol)</span>
                </button>
                <div className="grid max-h-60 grid-cols-1 gap-1 overflow-y-auto border-t border-slate-100 pt-1.5 sm:grid-cols-2">
                  {WEB3_WALLETS.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      className={`flex items-center gap-2 rounded-xl p-2 text-left text-sm transition hover:bg-slate-50 ${
                        walletLogo === wallet.id
                          ? "bg-indigo-50 font-semibold text-indigo-700"
                          : "text-slate-700"
                      }`}
                      onClick={(event) => {
                        selectWeb3Wallet(wallet.id);
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      <Web3WalletBadge wallet={wallet} className="h-7 w-7 rounded-lg" />
                      <span>{wallet.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </details>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => selectWeb3Wallet("")}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
                  !walletLogo
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
                }`}
              >
                <span>🪙</span>
                <span>Token logo</span>
              </button>
              {WEB3_WALLETS.slice(0, 6).map((wallet) => (
                <button
                  key={wallet.id}
                  type="button"
                  onClick={() => selectWeb3Wallet(wallet.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
                    walletLogo === wallet.id
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
                  }`}
                >
                  <Web3WalletBadge wallet={wallet} className="h-4 w-4 rounded" />
                  <span>{wallet.name}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Use the coin&apos;s own logo or pick a Web3 wallet logo like MetaMask, Phantom, or OKX Web3.
            </p>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Add via wallet address</p>
                <p className="text-xs text-slate-500">
                  Paste your public wallet address (Ethereum / EVM 0x…, Solana, Bitcoin bc1…, or Tron T…). EVM
                  wallets are detected with{" "}
                  <a
                    href="https://debank.com"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    DeBank
                  </a>{" "}
                  — every EVM chain it indexes (100+), prices and logos in one call — and fall back to a
                  direct on-chain read if it cannot answer.
                  <strong className="font-medium text-slate-600"> Import all</strong> files the tokens into
                  one folder for this wallet.
                </p>
              </div>
              {walletVisibleBalances.length > 0 && (
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => void handleImportAllWalletBalances()}
                  disabled={importingWallet || walletChosen.length === 0}
                >
                  {importingWallet
                    ? "Importing…"
                    : walletFileIntoFolder
                      ? `Import selected (${walletChosen.length}) into “${walletFolderLabel}”`
                      : `Import selected (${walletChosen.length}) to portfolio`}
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <input
                  className="input"
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void scanWallet();
                    }
                  }}
                  placeholder="0x… (Ethereum, BNB, Base, Arbitrum, Polygon), Solana, bc1…, or T…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <select
                className="input sm:w-36"
                value={walletChain}
                onChange={(event) => setWalletChain(event.target.value)}
                aria-label="Wallet blockchain"
              >
                {walletChainOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary shrink-0"
                onClick={() => void scanWallet()}
                disabled={scanningWallet || !walletAddress.trim()}
              >
                {scanningWallet ? "Scanning…" : "Scan wallet"}
              </button>
            </div>

            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-indigo-100 bg-white/70 p-2 sm:flex-row sm:items-center">
              <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={walletFileIntoFolder}
                  onChange={(event) => setWalletFileIntoFolder(event.target.checked)}
                />
                File into a folder
              </label>
              <input
                className="input min-w-0 flex-1 text-xs disabled:opacity-50"
                value={walletFolderName}
                onChange={(event) => setWalletFolderName(event.target.value)}
                disabled={!walletFileIntoFolder}
                maxLength={28}
                placeholder={`Folder name (optional) — ${walletFolderPlaceholder}`}
                aria-label="Folder name for the imported holdings"
              />
            </div>

            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-indigo-100 bg-white/70 p-2 sm:flex-row sm:items-center">
              <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={walletHideDust}
                  onChange={(event) => setWalletHideDust(event.target.checked)}
                />
                Skip tokens under
              </label>
              <div className="flex min-w-0 items-center gap-1">
                <span className="text-xs text-slate-500">$</span>
                <input
                  className="input w-20 text-xs disabled:opacity-50"
                  type="number"
                  min={0}
                  step="0.5"
                  inputMode="decimal"
                  value={walletDustThreshold}
                  onChange={(event) => setWalletDustThreshold(event.target.value)}
                  disabled={!walletHideDust}
                  aria-label="Hide tokens worth less than this many dollars"
                />
                <span className="text-xs text-slate-500">value</span>
              </div>
              <span className="text-[11px] text-slate-400">
                Dust stays out of the list and out of “Import all”.
              </span>
            </div>

            <label className="mt-2 flex items-center gap-2 rounded-xl border border-indigo-100 bg-white/70 p-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-indigo-600"
                checked={walletHideSpam}
                onChange={(event) => setWalletHideSpam(event.target.checked)}
              />
              Hide spam tokens
              <span className="font-normal text-[11px] text-slate-400">
                airdrops named after a website, promo wording, fake tickers
              </span>
            </label>

            <div className="mt-2 flex flex-col gap-x-4 gap-y-1 rounded-xl border border-indigo-100 bg-white/70 p-2 text-xs font-medium text-slate-600 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={walletHideImpostor}
                  onChange={(event) => setWalletHideImpostor(event.target.checked)}
                />
                Hide look-alike contracts
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={walletRequireMarket}
                  onChange={(event) => setWalletRequireMarket(event.target.checked)}
                />
                Only tokens with trading volume
              </label>
              <span className="font-normal text-[11px] text-slate-400">
                Contract matched against the official address, then checked for real 24h volume.
              </span>
            </div>

            {walletScanError && (
              <p className="mt-2 text-xs text-rose-600">{walletScanError}</p>
            )}
            {walletScanNote && (
              <p className="mt-2 text-xs text-slate-500">{walletScanNote}</p>
            )}
            {walletImportMessage && (
              <p className="mt-2 text-xs font-medium text-emerald-600">
                {walletImportMessage}
              </p>
            )}
            {walletScanDone && !walletScanError && walletBalances.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-500">
                  Found {walletBalances.length} balance{walletBalances.length === 1 ? "" : "s"}
                  {walletScanChainCount > 1 ? ` on ${walletScanChainCount} chains` : ""}
                  {walletScanSource === "debank" ? " via DeBank" : ""}
                  {walletSelection.counts.impostor > 0
                    ? ` · ${walletSelection.counts.impostor} look-alike hidden`
                    : ""}
                  {walletSelection.counts.spam > 0
                    ? ` · ${walletSelection.counts.spam} spam-looking hidden`
                    : ""}
                  {walletSelection.counts.thin > 0
                    ? ` · ${walletSelection.counts.thin} with no trading volume hidden`
                    : ""}
                  {walletSelection.counts.dust > 0
                    ? ` · ${walletSelection.counts.dust} under ${money(walletDustCut)} hidden (${money(
                        walletSelection.dustValue,
                      )})`
                    : ""}
                  {" · "}tick the ones to import, or click{" "}
                  <strong>Fill form</strong> on a token to edit it by hand.
                </p>

                {walletSelection.counts.impostor > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.impostor} token
                    {walletSelection.counts.impostor === 1 ? " uses" : "s use"} the right symbol on the
                    wrong contract — the usual fake-USDT trick.{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletHideImpostor(false)}
                    >
                      Show them
                    </button>
                  </p>
                ) : null}

                {walletSelection.counts.thin > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.thin} token
                    {walletSelection.counts.thin === 1 ? " has" : "s have"} traded under{" "}
                    {money(MIN_ORGANIC_VOLUME_USD)} in the last 24 hours across its pools, so its price
                    is not backed by a market.{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletRequireMarket(false)}
                    >
                      Show them
                    </button>
                  </p>
                ) : null}

                {walletSelection.counts.spam > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.spam} token
                    {walletSelection.counts.spam === 1 ? " looks" : "s look"} like airdrop spam.{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletHideSpam(false)}
                    >
                      Show them
                    </button>
                  </p>
                ) : null}

                {walletSelection.counts.dust > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.dust} token
                    {walletSelection.counts.dust === 1 ? " is" : "s are"} under{" "}
                    {money(walletDustCut)} ({money(walletSelection.dustValue)} in total).{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletHideDust(false)}
                    >
                      Show them
                    </button>
                  </p>
                ) : null}

                {walletVisibleBalances.length === 0 ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
                    Nothing in this wallet passed the filters. Untick the boxes above to see everything
                    the scan found.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                      <span>
                        {walletChosen.length} of {walletVisibleBalances.length} selected
                      </span>
                      <button
                        type="button"
                        className="font-medium text-indigo-600 hover:underline"
                        onClick={selectAllWalletBalances}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="font-medium text-indigo-600 hover:underline"
                        onClick={selectNoWalletBalances}
                      >
                        Select none
                      </button>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {walletVisibleBalances.map((item) => {
                        const chosen = walletChosenIds.has(item.id);
                        const traded = item.organicVolumeUsd;
                        return (
                          <div
                            key={item.id}
                            className={`w-44 shrink-0 rounded-xl border p-2 text-left transition ${
                              chosen
                                ? "border-indigo-500 bg-white ring-2 ring-indigo-100"
                                : "border-slate-200 bg-white hover:border-indigo-300"
                            }`}
                          >
                            <label className="flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
                                checked={chosen}
                                onChange={() => toggleWalletChoice(item.id)}
                                aria-label={`Import ${item.symbol}`}
                              />
                              <CryptoLogo
                                symbol={item.symbol}
                                name={item.name}
                                wallet={walletLogo}
                                logo={item.logoUrl}
                                className="h-7 w-7 rounded-lg"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-[10px] text-slate-400">
                                  {item.chainLabel}
                                </span>
                                <span className="block truncate font-semibold text-slate-900">
                                  {item.symbol}
                                </span>
                              </span>
                            </label>
                            <span className="mt-1 block text-xs font-medium tabular-nums text-slate-700">
                              {qty(item.quantity)} {item.symbol}
                            </span>
                            <span className="mt-0.5 block text-xs tabular-nums text-slate-500">
                              {money(item.valueUsd)} ({money(item.price)})
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                              {item.contractStatus === "official" ? (
                                <span
                                  className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700"
                                  title="The contract address is the official one for this token"
                                >
                                  official ✓
                                </span>
                              ) : null}
                              {traded !== undefined ? (
                                <span
                                  className={`rounded-full px-1.5 py-0.5 font-medium ${
                                    traded >= MIN_ORGANIC_VOLUME_USD
                                      ? "bg-slate-50 text-slate-600"
                                      : "bg-amber-50 text-amber-800"
                                  }`}
                                  title={
                                    item.washSuspected
                                      ? "Some pools traded implausibly more than their liquidity; that volume was left out"
                                      : "Organic 24h volume, ignoring dust pools and wash trading"
                                  }
                                >
                                  {shortUsd(traded)}/24h
                                </span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-medium text-indigo-600 hover:underline"
                              onClick={() => chooseWalletBalance(item)}
                            >
                              Fill form
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

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
