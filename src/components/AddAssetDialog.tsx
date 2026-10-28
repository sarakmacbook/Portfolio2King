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
import { MIN_LIQUIDITY_USD, MIN_ORGANIC_VOLUME_USD, shortUsd } from "@/lib/organic-volume";
import { BLOCKSCAN_CHAINS } from "@/lib/blockscan";
import { MORALIS_CHAINS } from "@/lib/moralis";
import {
  MIN_MARKET_CAP_USD,
  VERIFIED_LIQUIDITY_USD,
  VERIFIED_MARKET_CAP_USD,
  depthOf,
  filterScanBalances,
} from "@/lib/wallet-trust";
import {
  SCAN_SORTS,
  groupWalletBalancesByChain,
  marketCapTier,
  searchWalletBalances,
  shortMarketCap,
  sortWalletBalances,
  walletValueUsd,
  type ScanSort,
} from "@/lib/wallet-results";
import { MAX_FOLDERS, MAX_FOLDER_NAME_LENGTH, type HoldingFolder } from "@/lib/holdings-folders";
import {
  RECENT_ADDRESSES_KEY,
  addressKindHint,
  forgetAddress,
  parseRecentAddresses,
  parseWalletAddress,
  rememberAddress,
  type RecentAddress,
} from "@/lib/wallet-address";
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
import ScannerKeys from "./ScannerKeys";
import { ErrorNote, Modal, SubmitButton } from "./ui";
import CryptoLogo, { Web3WalletBadge } from "./CryptoLogo";

export type CashAccount = { id: number; name: string; quantity: number };
export type AssetFolderChoice = Pick<HoldingFolder, "id" | "name" | "color"> & { label?: string };

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
  folders = [],
  defaultType = "stock",
  defaultFolderId,
  allowCreateFolder = true,
  label = "+ Add asset",
  className = "btn-primary",
}: {
  cashAccounts: CashAccount[];
  /** Existing holdings folders, offered as the scan's filing target. */
  folders?: AssetFolderChoice[];
  defaultType?: AssetType;
  /** Folder preselected when adding directly into one. */
  defaultFolderId?: string;
  /** Disable creating a top-level folder when adding directly into a child folder. */
  allowCreateFolder?: boolean;
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
            folders={folders}
            defaultType={defaultType}
            defaultFolderId={defaultFolderId}
            allowCreateFolder={allowCreateFolder}
            onDone={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

function AddAssetForm({
  cashAccounts,
  folders,
  defaultType,
  defaultFolderId,
  allowCreateFolder,
  onDone,
}: {
  cashAccounts: CashAccount[];
  folders: AssetFolderChoice[];
  defaultType: AssetType;
  defaultFolderId?: string;
  allowCreateFolder: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ActionState, FormData>(createAsset, {});
  const [type, setType] = useState<AssetType>(defaultType);
  const [cryptoCategory, setCryptoCategory] = useState<CryptoCategory>("volatile");
  const [walletLogo, setWalletLogo] = useState<Web3WalletId | "">("");
  const [priceSource, setPriceSource] = useState<PriceProvider | "">("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [newFolderName, setNewFolderName] = useState("");
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
  /**
   * The addresses already scanned on this device (localStorage). Read in the
   * initialiser rather than an effect, which is safe here because the form only
   * mounts once the dialog is opened — always on the client, never during SSR.
   */
  const [walletRecent, setWalletRecent] = useState<RecentAddress[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return parseRecentAddresses(window.localStorage.getItem(RECENT_ADDRESSES_KEY));
    } catch {
      // Storage refused (private mode, quota): the box simply has no history.
      return [];
    }
  });
  /**
   * Which index answers the scan: DeBank (every chain it indexes) or Blockscan /
   * Etherscan V2. There is no chain filter any more — every scan covers every
   * chain both sources know, which is what the picker listed anyway.
   */
  const [walletSource, setWalletSource] = useState<"auto" | "blockscan" | "moralis">("auto");
  const [walletBalances, setWalletBalances] = useState<ScannedWalletBalance[]>([]);
  const [scanningWallet, setScanningWallet] = useState(false);
  const [walletScanError, setWalletScanError] = useState("");
  const [walletScanDone, setWalletScanDone] = useState(false);
  const [walletScanSource, setWalletScanSource] = useState<
    "debank" | "onchain" | "blockscan" | "moralis" | null
  >(null);
  const [walletScanNote, setWalletScanNote] = useState("");
  /**
   * Which scan source just reported a missing key. The "Scanner API keys" panel
   * opens and highlights that row, so the fix is one paste away instead of an
   * environment variable the user may not control.
   */
  const [scannerKeyPrompt, setScannerKeyPrompt] = useState<
    "" | "debank" | "etherscan" | "moralis"
  >("");
  const [importingWallet, setImportingWallet] = useState(false);
  /** Import the wallet's tokens into a folder, named by the user or by the address. */
  const [walletFileIntoFolder, setWalletFileIntoFolder] = useState(true);
  /** An existing folder to file into (`""` = make one, named below). */
  const [walletFolderId, setWalletFolderId] = useState(defaultFolderId ?? "");
  const [walletFolderName, setWalletFolderName] = useState("");
  /** Order of the results: real & big first by default. */
  const [walletSort, setWalletSort] = useState<ScanSort>("best");
  /** Hide tokens whose known market cap is under the floor. */
  const [walletMinMarketCap, setWalletMinMarketCap] = useState(true);
  /** Hide scanned balances worth less than `walletDustThreshold` (dust). */
  const [walletHideDust, setWalletHideDust] = useState(true);
  const [walletDustThreshold, setWalletDustThreshold] = useState(
    String(DEFAULT_DUST_THRESHOLD_USD),
  );
  /** Hide tokens that look like airdropped spam (ads, fake tickers). */
  const [walletHideSpam, setWalletHideSpam] = useState(true);
  /**
   * Show only tokens CoinMarketCap lists for their contract. On by default, but
   * only ever active when the lookup actually ran — a missing key leaves the
   * picker exactly as it was instead of emptying it.
   */
  const [walletOnlyCmc, setWalletOnlyCmc] = useState(true);
  /** Whether CoinMarketCap answered for the last scan (from the API). */
  const [walletCmcChecked, setWalletCmcChecked] = useState(false);
  /** Hide tokens whose contract is not the official one for their symbol. */
  const [walletHideImpostor, setWalletHideImpostor] = useState(true);
  /** Hide tokens nobody trades (unknown volume is always kept). */
  const [walletRequireMarket, setWalletRequireMarket] = useState(true);
  /**
   * The strict default: only tokens the scan could *verify* — an official
   * contract, an indexer's verdict, or a market deep enough to back the price.
   * Everything else is counted and one click away, so junk airdrops do not fill
   * the picker while a real holding is never lost.
   */
  const [walletRequireVerified, setWalletRequireVerified] = useState(true);
  /**
   * Tokens the user unticked. Kept as a set of *exclusions* rather than a set of
   * picks, so changing a filter never silently re-selects something they dropped.
   */
  const [walletDeselected, setWalletDeselected] = useState<Set<string>>(new Set());
  /** Search inside the scan's results — ticker, name, chain or CMC name. */
  const [walletQuery, setWalletQuery] = useState("");
  /** Results grouped by chain, each with its own count and value. */
  const [walletGroupByChain, setWalletGroupByChain] = useState(true);
  const [walletImportMessage, setWalletImportMessage] = useState("");
  const [customBankSelected, setCustomBankSelected] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isCash = type === "cash";

  /** How many distinct chains the last scan found balances on. */
  const walletScanChainCount = new Set(walletBalances.map((item) => item.chain)).size;

  /**
   * What is in the address box, parsed: the bare address to scan, what kind it
   * is, and what is wrong with it when something is. `parseWalletAddress` also
   * pulls the address out of a pasted explorer link.
   */
  const walletAddressParsed = useMemo(() => parseWalletAddress(walletAddress), [walletAddress]);

  /** Adds one address to the remembered list, in storage and on screen. */
  function rememberScannedAddress(address: string) {
    setWalletRecent((current) => {
      const next = rememberAddress(current, address);
      try {
        window.localStorage.setItem(RECENT_ADDRESSES_KEY, JSON.stringify(next));
      } catch {
        // Not being able to remember it is not a reason to fail the scan.
      }
      return next;
    });
  }

  /** Drops one remembered address. */
  function forgetScannedAddress(address: string) {
    setWalletRecent((current) => {
      const next = forgetAddress(current, address);
      try {
        window.localStorage.setItem(RECENT_ADDRESSES_KEY, JSON.stringify(next));
      } catch {
        // Ignored, as above.
      }
      return next;
    });
  }

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
        requireVerified: walletRequireVerified,
        // Only when CoinMarketCap actually answered: otherwise every token would
        // look "unlisted" and the picker would come back empty.
        onlyCmc: walletOnlyCmc && walletCmcChecked,
        // Market cap: only a *known* small cap is hidden, so a lookup that did
        // not answer can never shrink the list.
        minMarketCapUsd: walletMinMarketCap ? MIN_MARKET_CAP_USD : 0,
      }),
    [
      walletBalances,
      walletHideSpam,
      walletDustCut,
      walletHideImpostor,
      walletRequireMarket,
      walletRequireVerified,
      walletOnlyCmc,
      walletCmcChecked,
      walletMinMarketCap,
    ],
  );
  const walletVisibleBalances = walletSelection.kept;
  /** What "Import selected" imports: the kept tokens the user left ticked. */
  const walletChosen = walletVisibleBalances.filter((item) => !walletDeselected.has(item.id));
  const walletChosenIds = new Set(walletChosen.map((item) => item.id));
  /** What the ticked tokens add up to, so the total is visible before importing. */
  const walletChosenValue = walletValueUsd(walletChosen);
  /**
   * The kept tokens that match the search box (an empty box matches everything),
   * in the order the user asked for — real & big first unless they chose
   * otherwise.
   */
  const walletMatched = sortWalletBalances(
    searchWalletBalances(walletVisibleBalances, walletQuery),
    walletSort,
  );
  /** One group per chain, biggest first — see `wallet-results`. */
  const walletChainGroups = groupWalletBalancesByChain(walletMatched);
  /** Folder the scan would be filed into; blank means "name it after the address". */
  /** The address that will actually be scanned / imported, link or not. */
  const walletCleanAddress = walletAddressParsed.address || walletAddress.trim();
  const walletFolderPlaceholder = shortWalletAddress(walletCleanAddress) || "0x1234…abcd";
  /** The folder picked from the dropdown, when it still exists. */
  const walletPickedFolder = folders.find((folder) => folder.id === walletFolderId);
  const walletFolderLabel = walletPickedFolder
    ? walletPickedFolder.name
    : walletFolderName.trim() || walletFolderPlaceholder;
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

  async function scanWallet(rawInput: string = walletAddress) {
    // Whatever was pasted is reduced to the address first: an explorer link, a
    // line of chat, or a trailing space all scan the same wallet.
    const parsed = parseWalletAddress(rawInput);
    if (parsed.status === "empty") {
      setWalletScanError("Paste a wallet address first (0x…, Solana, bc1…, or T…).");
      return;
    }
    if (parsed.status === "invalid" || !parsed.address) {
      setWalletScanError(parsed.message ?? "That is not a wallet address this app can scan.");
      return;
    }
    const trimmed = parsed.address;
    // The box shows the bare address from here on, so it is obvious what is
    // being scanned when a link or a line of text was pasted.
    if (walletAddress.trim() !== trimmed) setWalletAddress(trimmed);
    if (parsed.checksumFailed) setWalletScanError(parsed.message ?? "");
    else setWalletScanError("");
    setScanningWallet(true);
    setWalletScanError("");
    setWalletImportMessage("");
    // Until *this* scan reports back, no CoinMarketCap answer is assumed — the
    // filter stays inert instead of reading "not asked" as "not listed".
    setWalletCmcChecked(false);
    setWalletScanDone(false);
    setScannerKeyPrompt("");
    try {
      const params = new URLSearchParams({
        address: trimmed,
        chain: "auto",
        source: walletSource,
      });
      const response = await fetch(`/api/wallet/scan?${params.toString()}`);
      const data = (await response.json()) as {
        error?: string;
        balances?: ScannedWalletBalance[];
        source?: "debank" | "blockscan" | "moralis" | "onchain";
        sourceNote?: string;
        debankNeedsKey?: boolean;
        blockscanNeedsKey?: boolean;
        blockscanProOnly?: boolean;
        blockscanFreeFallback?: boolean;
        blockscanFreeUnread?: number;
        blockscanSkippedChains?: number;
        moralisNeedsKey?: boolean;
        /** CoinMarketCap answered for this scan (so the CMC filter is meaningful). */
        cmcChecked?: boolean;
        cmcListed?: number;
        moralisSkippedChains?: number;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not scan that wallet address.");
      }
      const list = data.balances || [];
      setWalletBalances(list);
      // A new scan starts with everything ticked again.
      setWalletDeselected(new Set());
      setWalletScanDone(true);
      // Remembered on this device, so the next scan is one click.
      rememberScannedAddress(trimmed);
      setWalletScanSource(data.source ?? null);
      setWalletCmcChecked(data.cmcChecked === true);
      setScannerKeyPrompt(
        data.source === "moralis" && data.moralisNeedsKey
          ? "moralis"
          : data.source === "blockscan" && data.blockscanNeedsKey
            ? "etherscan"
            : data.source === "onchain" && data.debankNeedsKey
              ? "debank"
              : "",
      );
      // Only mention DeBank when it was actually involved, so the picker stays
      // quiet on a plain on-chain read for Solana / Bitcoin / Tron.
      // Where the numbers came from, said plainly. DeBank being unavailable is
      // a smaller scan, not an error — and when the cause is a missing key, the
      // note says so once and names the fix.
      setWalletScanNote(
        data.source === "moralis"
          ? [
              data.moralisNeedsKey
                ? "Moralis needs an API key — this scan used the other sources. Add one under Scanner API keys below (or set MORALIS_API_KEY); a free key from moralis.com covers every chain here."
                : data.sourceNote
                  ? data.sourceNote
                  : "",
              data.moralisSkippedChains
                ? `${data.moralisSkippedChains} chain${data.moralisSkippedChains === 1 ? "" : "s"} were not reached before the time limit; scan again in a moment to cover the rest.`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : data.source === "blockscan"
          ? [
              data.blockscanNeedsKey
                ? "Blockscan needs an Etherscan API key — this scan fell back to reading the chains directly, so it sees fewer tokens. Add one under Scanner API keys below (or set ETHERSCAN_API_KEY); the key from etherscan.io is free."
                : data.blockscanFreeFallback
                  ? `This Etherscan key is on the free plan, so token holdings came from the wallet's transfer history (tokentx → tokenbalance) rather than the paid holdings endpoint — fewer tokens than a paid key sees, but real balances. Prices were looked up separately.${data.blockscanFreeUnread ? ` ${data.blockscanFreeUnread} more token${data.blockscanFreeUnread === 1 ? "" : "s"} were in that history but past the time limit; scan again to cover them.` : ""}`
                  : data.blockscanProOnly
                    ? "Blockscan answered, but token holdings need a paid Etherscan plan on that key, and the free transfer history had no tokens either — the tokens below came from the chains directly."
                    : data.sourceNote
                      ? data.sourceNote
                      : "",
              data.blockscanSkippedChains
                ? `${data.blockscanSkippedChains} chain${data.blockscanSkippedChains === 1 ? "" : "s"} were not reached before the time limit (Etherscan allows 2 calls a second); scan again in a moment to cover the rest.`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : data.source !== "onchain"
            ? ""
            : data.debankNeedsKey
              ? "No source could answer — DeBank only lists tokens with an access key. This scan read the chains directly, which sees fewer tokens. Add a free DeBank key under Scanner API keys below (or set DEBANK_ACCESS_KEY) to cover every chain DeBank indexes."
              : data.blockscanNeedsKey
                ? "Blockscan needs an Etherscan API key, so this scan read the chains directly — which sees fewer tokens. Add one under Scanner API keys below (or set ETHERSCAN_API_KEY); the key from etherscan.io is free."
                : data.moralisNeedsKey
                  ? "Moralis needs an API key, so this scan read the chains directly — which sees fewer tokens. Add one under Scanner API keys below (or set MORALIS_API_KEY); a free key from moralis.com covers every chain here."
                  : data.sourceNote
                    ? `Read directly from the chains — ${data.sourceNote}`
                    : "Read directly from the chains.",
      );
      if (list.length === 0) {
        // Never say "empty wallet" when the source itself refused.
        setWalletScanError(
          data.sourceNote && data.source === "blockscan"
            ? data.sourceNote
            : "No non-zero balances found on that wallet address.",
        );
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

  /**
   * Tick every visible token (after the user unticked some). With a search in
   * the box this is "everything shown", which is what it looks like.
   */
  function selectAllWalletBalances() {
    setWalletDeselected((current) => {
      const next = new Set(current);
      for (const item of walletMatched) next.delete(item.id);
      return next;
    });
  }

  /** Tick or untick a whole chain at once, from its group header. */
  function toggleWalletChain(items: readonly ScannedWalletBalance[]) {
    const everyOneChosen = items.every((item) => !walletDeselected.has(item.id));
    setWalletDeselected((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (everyOneChosen) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  /** Untick every visible token — again, the ones the search shows. */
  function selectNoWalletBalances() {
    setWalletDeselected((current) => {
      const next = new Set(current);
      for (const item of walletMatched) next.add(item.id);
      return next;
    });
  }

  async function handleImportAllWalletBalances() {
    if (walletChosen.length === 0) return;
    setImportingWallet(true);
    setWalletScanError("");
    setWalletImportMessage("");
    try {
      const result = await importWalletBalances({
        address: walletCleanAddress,
        walletLogo,
        priceSource,
        // A picked folder is sent by id so the server files into that exact one;
        // otherwise the name (blank = named after the address) creates or reuses.
        folderName: walletFileIntoFolder ? walletFolderName.trim() : null,
        folderId: walletFileIntoFolder && walletPickedFolder ? walletPickedFolder.id : null,
        // The server applies the same rules, so a stale client cannot slip
        // dust or spam into the portfolio.
        minValueUsd: walletDustCut,
        skipSpam: walletHideSpam,
        skipImpostor: walletHideImpostor,
        // The server re-applies the same rule, so a stale page cannot import a
        // token CoinMarketCap does not know.
        requireCmc: walletOnlyCmc && walletCmcChecked,
        minOrganicVolumeUsd: walletRequireMarket ? MIN_ORGANIC_VOLUME_USD : 0,
        minLiquidityUsd: walletRequireMarket ? MIN_LIQUIDITY_USD : 0,
        skipUnverified: walletRequireVerified,
        // `cmcId` rides along so the server can re-apply the CoinMarketCap rule
        // instead of trusting the page's filter state.
        balances: walletChosen.map((item) => ({
          ...item,
          chain: item.chain,
          ...(item.cmcId !== undefined ? { cmcId: item.cmcId } : {}),
        })),
      });
      if (!result.ok) {
        throw new Error(result.error || "Could not import wallet balances.");
      }
      playMoneyChimeFromGesture();
      const count = `${result.importedCount} holding${result.importedCount === 1 ? "" : "s"}`;
      const skipped = [
        result.skippedDust ? `Skipped ${result.skippedDust} under ${money(walletDustCut)}.` : "",
        result.skippedSpam ? `Skipped ${result.skippedSpam} that looked like spam.` : "",
        result.skippedUnlisted
          ? `Skipped ${result.skippedUnlisted} that CoinMarketCap does not list.`
          : "",
        result.skippedImpostor
          ? `Skipped ${result.skippedImpostor} with the wrong contract address.`
          : "",
        result.skippedThin ? `Skipped ${result.skippedThin} with no trading volume.` : "",
        result.skippedShallow
          ? `Skipped ${result.skippedShallow} with too little liquidity.`
          : "",
        result.skippedUnverified
          ? `Skipped ${result.skippedUnverified} that could not be verified as a real token.`
          : "",
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

  /**
   * One token card — used by both the grouped and the flat list, so a card
   * looks the same however the results are arranged.
   */
  function walletCard(item: ScannedWalletBalance) {
    const chosen = walletChosenIds.has(item.id);
    const traded = item.organicVolumeUsd;
    const depth = depthOf(item);
    return (
      <div
        className={`rounded-xl border p-2 text-left transition ${
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
        <span
          className="mt-0.5 block text-xs tabular-nums text-slate-500"
          title={
            item.priced
              ? undefined
              : "No price was found for this token, so it is kept but not counted as dust"
          }
        >
          {item.priced
            ? `${money(item.valueUsd)} (${money(item.price)})`
            : `no price yet · ${qty(item.quantity)} ${item.symbol}`}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
          {item.contractStatus === "official" ? (
            <span
              className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700"
              title={
                item.cmcVerified && item.cmcName
                  ? `The contract address is the official one for this token, confirmed on CoinMarketCap as ${item.cmcName}`
                  : "The contract address is the official one for this token"
              }
            >
              official ✓
            </span>
          ) : null}
          {item.cmcSymbolMismatch && item.cmcName ? (
            <span
              className="rounded-full bg-slate-50 px-1.5 py-0.5 font-medium text-slate-600"
              title={`CoinMarketCap lists this contract as ${item.cmcName}. The ticker shown is the one the wallet scan reported — bridged tokens and renamed tickers differ like this.`}
            >
              CMC: {item.cmcName}
            </span>
          ) : null}
          {item.marketCapUsd ? (
            <span
              className={`rounded-full px-1.5 py-0.5 font-medium ${
                marketCapTier(item.marketCapUsd) === "major"
                  ? "bg-emerald-50 text-emerald-700"
                  : marketCapTier(item.marketCapUsd) === "large"
                    ? "bg-emerald-50 text-emerald-700"
                    : marketCapTier(item.marketCapUsd) === "mid"
                      ? "bg-slate-50 text-slate-600"
                      : "bg-amber-50 text-amber-800"
              }`}
              title={`Market cap ${money(item.marketCapUsd)} — ${
                item.cmcId !== undefined ? "from CoinMarketCap" : "from DexScreener"
              }. A ticker is free to copy; a cap this size is not.`}
            >
              {shortMarketCap(item.marketCapUsd)} cap
            </span>
          ) : null}
          {item.liquidityUsd !== undefined ? (
            <span
              className={`rounded-full px-1.5 py-0.5 font-medium ${
                depth === "deep"
                  ? "bg-emerald-50 text-emerald-700"
                  : depth === "shallow"
                    ? "bg-amber-50 text-amber-800"
                    : "bg-slate-50 text-slate-600"
              }`}
              title={
                depth === "deep"
                  ? `Deep liquidity: ${money(item.liquidityUsd)} pooled, deepest pool ${money(item.deepestPoolUsd ?? 0)}`
                  : depth === "shallow"
                    ? `Thin: only ${money(item.liquidityUsd)} pooled — a fake token can hold a few hundred dollars of its own liquidity`
                    : `Liquidity: ${money(item.liquidityUsd)} pooled across ${item.marketPairs ?? 0} pool(s)`
              }
            >
              {shortUsd(item.liquidityUsd)} liq
              {depth === "deep" ? " ✓" : ""}
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
                  className={`input ${
                    walletAddressParsed.error && walletAddress.trim() ? "border-rose-300" : ""
                  }`}
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  // A pasted link is reduced to the address straight away, so the
                  // box shows what will be scanned rather than a URL.
                  onPaste={(event) => {
                    const text = event.clipboardData.getData("text");
                    if (!text) return;
                    const parsed = parseWalletAddress(text);
                    if (parsed.status === "valid" && parsed.address !== text.trim()) {
                      event.preventDefault();
                      setWalletAddress(parsed.address);
                      setWalletScanError("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void scanWallet();
                    }
                  }}
                  placeholder="0x… (Ethereum, BNB, Base, Arbitrum, Polygon), Solana, bc1…, or T…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Wallet address to scan"
                  aria-invalid={walletAddressParsed.error && Boolean(walletAddress.trim())}
                />
                {walletAddress.trim() ? (
                  <p
                    className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                      walletAddressParsed.error ? "text-rose-600" : "text-slate-500"
                    }`}
                  >
                    {walletAddressParsed.kindLabel ? (
                      <span
                        className="rounded-full bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700"
                        title={addressKindHint(walletAddressParsed.kind ?? "evm")}
                      >
                        {walletAddressParsed.kindLabel}
                      </span>
                    ) : null}
                    {walletAddressParsed.short ? (
                      <span className="tabular-nums text-slate-500">{walletAddressParsed.short}</span>
                    ) : null}
                    <span>
                      {walletAddressParsed.message ??
                        (walletAddressParsed.kind && walletAddressParsed.kind !== "evm"
                          ? addressKindHint(walletAddressParsed.kind)
                          : "")}
                    </span>
                  </p>
                ) : null}
              </div>
              <select
                className="input sm:w-44"
                value={walletSource}
                onChange={(event) => {
                  const value = event.target.value;
                  setWalletSource(
                    value === "blockscan" || value === "moralis" ? value : "auto",
                  );
                }}
                aria-label="Where to scan for the tokens"
                title="Which index is asked for the token list"
              >
                <option value="auto">Scan via DeBank</option>
                <option value="blockscan">Scan via Blockscan</option>
                <option value="moralis">Scan via Moralis</option>
              </select>
              <button
                type="button"
                className="btn-primary shrink-0"
                onClick={() => void scanWallet()}
                disabled={scanningWallet || walletAddressParsed.status !== "valid"}
                title={
                  walletAddressParsed.status === "valid"
                    ? undefined
                    : "Paste a complete address — 0x…, Solana base58, bc1… / 1…, or T…"
                }
              >
                {scanningWallet ? "Scanning…" : "Scan wallet"}
              </button>
            </div>

            {walletRecent.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-600">Recent:</span>
                {walletRecent.map((item) => {
                  const itemKind = parseWalletAddress(item.address).kindLabel;
                  const selected = item.address === walletAddress.trim();
                  return (
                    <span
                      key={item.address}
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${
                        selected
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => {
                          setWalletAddress(item.address);
                          setWalletScanError("");
                          void scanWallet(item.address);
                        }}
                        title={`Scan ${item.address} again${itemKind ? ` (${itemKind})` : ""}`}
                      >
                        {item.label ? `${item.label} · ` : ""}
                        {item.address.slice(0, 6)}…{item.address.slice(-4)}
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-600"
                        onClick={() => forgetScannedAddress(item.address)}
                        aria-label={`Forget ${item.address}`}
                        title="Forget this address on this device"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                <span aria-label="Recently scanned wallet addresses" className="sr-only">
                  Recently scanned wallet addresses
                </span>
              </div>
            )}

            {walletSource === "blockscan" && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Blockscan is Etherscan&apos;s multichain explorer. Its API (Etherscan V2) reads{" "}
                {BLOCKSCAN_CHAINS.length} chains with one key, paced at 2 calls a second, so a
                whole-wallet sweep takes about ten seconds. It needs{" "}
                <code className="rounded bg-slate-100 px-1">ETHERSCAN_API_KEY</code> — add it in{" "}
                <strong className="font-medium text-slate-600">Scanner API keys</strong> below; without
                one the scan still reads the chains directly and says so. A free key falls back to the
                wallet&apos;s transfer history, so it still finds tokens — that is the cheapest way to
                scan.
              </p>
            )}

            {walletSource === "moralis" && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Moralis is the only source that labels a token as a scam itself
                (<code className="rounded bg-slate-100 px-1">possible_spam</code>), so airdropped
                junk is counted as spam instead of having to be spotted by its name. It reads{" "}
                {MORALIS_CHAINS.length} chains with one{" "}
                <code className="rounded bg-slate-100 px-1">MORALIS_API_KEY</code> from moralis.com —
                add it in <strong className="font-medium text-slate-600">Scanner API keys</strong> below;
                without a key the scan says so and falls back to the other sources.
              </p>
            )}

            <div className="mt-2 space-y-2 rounded-xl border border-indigo-100 bg-white/70 p-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-indigo-600"
                    checked={walletFileIntoFolder}
                    onChange={(event) => setWalletFileIntoFolder(event.target.checked)}
                  />
                  Import as one folder
                </label>
                <select
                  className="input min-w-0 flex-1 text-xs disabled:opacity-50"
                  value={walletPickedFolder?.id ?? ""}
                  onChange={(event) => setWalletFolderId(event.target.value)}
                  disabled={!walletFileIntoFolder}
                  aria-label="Folder to import the scanned tokens into"
                >
                  <option value="">
                    New folder{walletFolderName.trim() ? `: ${walletFolderName.trim()}` : ` — ${walletFolderPlaceholder}`}
                  </option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.label ?? folder.name}
                    </option>
                  ))}
                </select>
              </div>
              {walletFileIntoFolder && !walletPickedFolder && (
                <input
                  className="input w-full text-xs"
                  value={walletFolderName}
                  onChange={(event) => setWalletFolderName(event.target.value)}
                  maxLength={MAX_FOLDER_NAME_LENGTH}
                  placeholder={`Folder name (optional) — ${walletFolderPlaceholder}`}
                  aria-label="Folder name for the imported holdings"
                />
              )}
              <p className="text-[11px] leading-relaxed text-slate-500">
                {!walletFileIntoFolder
                  ? "The tokens are imported loose, with no folder."
                  : walletPickedFolder
                    ? folders.length > 0
                      ? `All ${walletChosen.length || 0} ticked token${
                          walletChosen.length === 1 ? "" : "s"
                        } go into your existing “${walletPickedFolder.name}” folder — scanning the same wallet again tops up the same folder.`
                      : ""
                    : `All ticked tokens go into one new folder, called “${walletFolderLabel}”.`}
              </p>
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
                Only tokens with a real market
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={walletRequireVerified}
                  onChange={(event) => setWalletRequireVerified(event.target.checked)}
                />
                Only real tokens
              </label>
              <label
                className="flex items-center gap-2"
                title={
                  walletCmcChecked
                    ? "Show only tokens CoinMarketCap lists for that exact contract address"
                    : "CoinMarketCap answered for none of these contracts, so this filter is off"
                }
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600 disabled:opacity-50"
                  checked={walletOnlyCmc && walletCmcChecked}
                  disabled={!walletCmcChecked}
                  onChange={(event) => setWalletOnlyCmc(event.target.checked)}
                />
                Only tokens on CoinMarketCap
              </label>
              <label
                className="flex items-center gap-2"
                title={`A market cap of at least $${(MIN_MARKET_CAP_USD / 1_000_000).toFixed(0)}M. A ticker can be faked; a cap cannot. A token whose cap could not be looked up is always kept.`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={walletMinMarketCap}
                  onChange={(event) => setWalletMinMarketCap(event.target.checked)}
                />
                Only real market cap (${(MIN_MARKET_CAP_USD / 1_000_000).toFixed(0)}M+)
              </label>
              <span className="font-normal text-[11px] text-slate-400">
                Official contract, an indexer&apos;s verification, or{" "}
                {shortUsd(VERIFIED_LIQUIDITY_USD)}+ of pooled liquidity with{" "}
                {shortUsd(MIN_ORGANIC_VOLUME_USD)}+ traded in 24h. Unchecked shows every token the
                scan found, junk included.
              </span>
              {!walletCmcChecked && (
                <span className="font-normal text-[11px] text-slate-400">
                  No CoinMarketCap answer for this scan, so the list is not filtered by it. Add a key
                  under Scanner API keys (or set <code className="text-[11px]">CMC_PRO_API_KEY</code>)
                  to turn that filter on.
                </span>
              )}
            </div>

            <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-600">
                How the scan finds tokens
              </summary>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-500">
                <li>
                  <strong className="font-medium text-slate-600">One source answers</strong> — a scan
                  asks the source you picked and shows <em>its</em> answer: no second opinion, no
                  merged long tail, no airdropped look-alikes from an explorer nobody asked about.
                  Every row then goes through the same checks below.
                </li>
                <li>
                  <strong className="font-medium text-slate-600">0x… (EVM)</strong> — DeBank by
                  default, for every chain it indexes, prices included. If DeBank cannot answer, the
                  other keyed sources are tried in turn (Moralis, then Blockscan) and the chains are
                  read <strong className="font-medium text-slate-600">only when</strong> none of them
                  can: public RPC on Ethereum, BNB Chain, Arbitrum, Base, Polygon, Optimism and
                  Avalanche, plus Blockscout then Routescan.
                </li>
                <li>
                  <strong className="font-medium text-slate-600">Moralis</strong> — the source to pick
                  when a wallet is full of junk: it returns a `possible_spam` flag per token, so
                  spam is counted and hidden instead of guessed from the name. One{" "}
                  <code className="rounded bg-slate-100 px-1">MORALIS_API_KEY</code> (or a key saved
                  in Scanner API keys),{" "}
                  {MORALIS_CHAINS.length} chains, prices and logos included.
                </li>
                <li>
                  <strong className="font-medium text-slate-600">Blockscan</strong> — pick it in the
                  scan menu to ask Etherscan V2 (the API behind blockscan.com) instead: one key,{" "}
                  {BLOCKSCAN_CHAINS.length} chains, prices included. It is paced at 2 calls a second
                  and needs{" "}
                  <code className="rounded bg-slate-100 px-1">ETHERSCAN_API_KEY</code> or a key saved
                  in Scanner API keys. A free key reads token holdings through the wallet&apos;s
                  transfer history (<code className="rounded bg-slate-100 px-1">tokentx</code> →{" "}
                  <code className="rounded bg-slate-100 px-1">tokenbalance</code>); a paid key reads
                  them in one call per chain, with prices.
                </li>
                <li>
                  <strong className="font-medium text-slate-600">Solana</strong> — public RPC token
                  accounts and known mints. <strong className="font-medium text-slate-600">Bitcoin</strong>{" "}
                  — mempool.space, then blockstream.info.{" "}
                  <strong className="font-medium text-slate-600">Tron</strong> — Tronscan.
                </li>
                <li>
                  <strong className="font-medium text-slate-600">Pricing</strong> — the index&apos;s
                  price is used when it has one; a balance it could not price is quoted from the
                  market APIs instead of being shown (or filtered) as $0.
                </li>
                <li>
                  <strong className="font-medium text-slate-600">Then the checks</strong> — official
                  contract table, a <strong className="font-medium text-slate-600">CoinMarketCap</strong>{" "}
                  lookup of every contract a scan returns (50 per call), organic 24h volume and
                  liquidity depth from DexScreener (30 contracts per call).
                </li>
                <li>
                  <strong className="font-medium text-slate-600">Limits</strong> — up to 250 tokens
                  from DeBank, 150 per chain from the explorers, 6–8 s per request.
                </li>
              </ul>
            </details>

            <ScannerKeys key={scannerKeyPrompt || "scanner-keys"} highlight={scannerKeyPrompt} />

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
                  {walletScanSource === "debank"
                    ? " via DeBank"
                    : walletScanSource === "blockscan"
                      ? " via Blockscan"
                      : walletScanSource === "moralis"
                        ? " via Moralis"
                        : ""}
                  {walletSelection.counts.impostor > 0
                    ? ` · ${walletSelection.counts.impostor} look-alike hidden`
                    : ""}
                  {walletSelection.counts.spam > 0
                    ? ` · ${walletSelection.counts.spam} spam-looking hidden`
                    : ""}
                  {walletSelection.counts.unverified > 0
                    ? ` · ${walletSelection.counts.unverified} unverified hidden`
                    : ""}
                  {walletSelection.counts.unlisted > 0
                    ? ` · ${walletSelection.counts.unlisted} not on CoinMarketCap hidden`
                    : ""}
                  {walletSelection.counts.smallcap > 0
                    ? ` · ${walletSelection.counts.smallcap} under ${shortUsd(MIN_MARKET_CAP_USD)} market cap hidden`
                    : ""}
                  {walletSelection.counts.thin > 0
                    ? ` · ${walletSelection.counts.thin} with no real market hidden`
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

                {walletSelection.counts.unverified > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.unverified} token
                    {walletSelection.counts.unverified === 1 ? " could" : "s could"} not be verified
                    as real — no official contract, no indexer check, and no market deep enough
                    ({shortUsd(VERIFIED_LIQUIDITY_USD)} pooled) to back the price. Airdrop junk
                    almost always lands here.{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletRequireVerified(false)}
                    >
                      Show them
                    </button>
                  </p>
                ) : null}

                {walletSelection.counts.thin > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.thin} token
                    {walletSelection.counts.thin === 1 ? " has" : "s have"} no real market — under{" "}
                    {shortUsd(MIN_LIQUIDITY_USD)} of pooled liquidity or under{" "}
                    {shortUsd(MIN_ORGANIC_VOLUME_USD)} traded in 24h — so the price shown is not backed
                    by anything.{" "}
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

                {walletSelection.counts.unlisted > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.unlisted} token
                    {walletSelection.counts.unlisted === 1 ? " is" : "s are"} not listed on
                    CoinMarketCap for that contract address.{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletOnlyCmc(false)}
                    >
                      Show them
                    </button>
                  </p>
                ) : null}

                {walletSelection.counts.smallcap > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {walletSelection.counts.smallcap} token
                    {walletSelection.counts.smallcap === 1 ? " has" : "s have"} a known market cap
                    under {shortUsd(MIN_MARKET_CAP_USD)} — small enough that a fake could hold one,
                    though some are honest micro-caps. A token whose cap could not be looked up is
                    never counted here.{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setWalletMinMarketCap(false)}
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
                    Nothing in this wallet passed the filters. Untick the boxes above — including the
                    CoinMarketCap one — to see everything the scan found.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <input
                        className="input h-8 w-full max-w-[13rem] text-xs"
                        placeholder="Search ticker, name or chain…"
                        value={walletQuery}
                        onChange={(event) => setWalletQuery(event.target.value)}
                        onKeyDown={(event) => {
                          // This dialog is a form: Enter in the search box must not submit it.
                          if (event.key === "Enter") event.preventDefault();
                        }}
                        aria-label="Search the tokens this scan found"
                      />
                      {walletQuery ? (
                        <button
                          type="button"
                          className="font-medium text-indigo-600 hover:underline"
                          onClick={() => setWalletQuery("")}
                        >
                          Clear
                        </button>
                      ) : null}
                      <label className="flex items-center gap-1.5" title="How the tokens are ordered">
                        <span>Sort</span>
                        <select
                          className="input h-7 py-0 text-[11px]"
                          value={walletSort}
                          onChange={(event) => setWalletSort(event.target.value as ScanSort)}
                          aria-label="Order of the scanned tokens"
                        >
                          {SCAN_SORTS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {walletChainGroups.length > 1 ? (
                        <label
                          className="flex items-center gap-1.5"
                          title="One section per chain, biggest first"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-indigo-600"
                            checked={walletGroupByChain}
                            onChange={(event) => setWalletGroupByChain(event.target.checked)}
                          />
                          Group by chain
                        </label>
                      ) : null}
                      <span className="ml-auto tabular-nums">
                        {walletQuery
                          ? `${walletMatched.length} of ${walletVisibleBalances.length} shown`
                          : `${walletVisibleBalances.length} token${
                              walletVisibleBalances.length === 1 ? "" : "s"
                            }`}
                        {walletChosen.length > 0
                          ? ` · ${walletChosen.length} selected · ${money(walletChosenValue)}`
                          : " · nothing selected"}
                      </span>
                      <button
                        type="button"
                        className="font-medium text-indigo-600 hover:underline"
                        title={walletQuery ? "Selects the tokens matching the search" : undefined}
                        onClick={selectAllWalletBalances}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="font-medium text-indigo-600 hover:underline"
                        title={walletQuery ? "Unticks the tokens matching the search" : undefined}
                        onClick={selectNoWalletBalances}
                      >
                        Select none
                      </button>
                    </div>
                    {walletMatched.length === 0 ? (
                      <p className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                        No token here matches “{walletQuery.trim()}”.{" "}
                        <button
                          type="button"
                          className="font-medium text-indigo-600 hover:underline"
                          onClick={() => setWalletQuery("")}
                        >
                          Clear the search
                        </button>
                      </p>
                    ) : walletGroupByChain && walletChainGroups.length > 1 ? (
                      <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
                        {walletChainGroups.map((group) => (
                          <div key={group.chain} className="space-y-1.5">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[11px]">
                              <span className="font-semibold text-slate-600">{group.label}</span>
                              <span className="tabular-nums text-slate-400">
                                {group.items.filter((item) => !walletDeselected.has(item.id)).length} of{" "}
                                {group.items.length} ticked · {money(group.valueUsd)}
                                <button
                                  type="button"
                                  className="ml-2 font-medium text-indigo-600 hover:underline"
                                  onClick={() => toggleWalletChain(group.items)}
                                  title="Tick or untick every token on this chain"
                                >
                                  {group.items.every((item) => !walletDeselected.has(item.id))
                                    ? "Untick chain"
                                    : "Tick chain"}
                                </button>
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {group.items.map((item) => (
                                <div key={item.id}>{walletCard(item)}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid max-h-[24rem] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                        {walletMatched.map((item) => (
                          <div key={item.id}>{walletCard(item)}</div>
                        ))}
                      </div>
                    )}
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
              spot order-book midpoint — no API key needed. Auto tries every exchange.
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

      <div>
        <label className="label" htmlFor="new-holding-folder">Folder</label>
        <select
          id="new-holding-folder"
          name="folderId"
          className="input"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="">No folder</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.label ?? folder.name}
            </option>
          ))}
          {allowCreateFolder && folders.length < MAX_FOLDERS && (
            <option value="__new__">Create a new folder…</option>
          )}
        </select>
        {folderId === "__new__" ? (
          <div className="mt-2">
            <label className="label" htmlFor="new-folder-name">New folder name</label>
            <input
              id="new-folder-name"
              name="folderName"
              className="input"
              value={newFolderName}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="e.g. Long term, Binance"
              required
            />
            <p className="mt-1 text-xs text-slate-400">This holding will be added to the new folder.</p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Choose an existing folder or create one while adding this holding.</p>
        )}
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
