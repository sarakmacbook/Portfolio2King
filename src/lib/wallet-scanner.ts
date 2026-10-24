import type { CryptoCategory } from "@/db/schema";
import { debankAccessKey, fetchDebankBalances, type DebankBalance } from "@/lib/debank";
import { blockscanApiKey, fetchBlockscanBalances } from "@/lib/blockscan";
import { fetchMoralisBalances, moralisApiKey } from "@/lib/moralis";
import { fetchBlockscoutTokens } from "@/lib/blockscout";
import { type DiscoveredToken } from "@/lib/discovered-tokens";
import { fetchRoutescanTokens } from "@/lib/routescan";
import { fetchPreferredMarketPrice } from "@/lib/market-prices";
import { STABLECOIN_SYMBOLS } from "@/lib/stablecoins";
import {
  WALLET_CHAIN_LABELS,
  detectWalletAddressKind,
  normaliseWalletChain,
  type WalletAddressKind,
  type WalletChain,
} from "@/lib/wallet-chains";

/**
 * The chain vocabulary lives in `wallet-chains` so the DeBank client can share
 * it; re-exported here because every caller imports it from the scanner.
 */
export {
  WALLET_CHAINS,
  WALLET_CHAIN_LABELS,
  canonicalChainId,
  detectWalletAddressKind,
  isValidWalletChain,
  normaliseWalletChain,
  shortWalletAddress,
} from "@/lib/wallet-chains";
export type { WalletAddressKind, WalletChain } from "@/lib/wallet-chains";

export type ScannedWalletBalance = {
  id: string;
  symbol: string;
  name: string;
  /**
   * The chain the balance sits on. Known chains use the app's id (`ethereum`,
   * `arbitrum`, …); any other chain DeBank indexes keeps its DeBank id
   * (`sonic`, `zora`, …), so a token is never dropped for being on a chain this
   * app does not list by hand.
   */
  chain: string;
  chainLabel: string;
  quantity: number;
  price: number;
  valueUsd: number;
  /**
   * Whether the scan could put a price on the balance. `false` means "unknown
   * price", which is different from "worth nothing" — the picker keeps those
   * rather than treating them as dust. Optional because the raw per-chain
   * readers only produce quantity; the pricing pass fills it in.
   */
  priced?: boolean;
  category: CryptoCategory;
  contract: string | null;
  /** Token artwork, when the indexer returned one (DeBank does). */
  logoUrl?: string;
  /**
   * The indexer's own spam verdict. Spam is usually visible in the name, but a
   * scam token can be named "USDC" — this is the only signal for that case.
   */
  spam?: boolean;
  /**
   * The indexer's own verification verdict (DeBank `is_verified`, Moralis
   * `verified_contract`, a Blockscout/Routescan `verified` reputation): one more
   * reason to keep a token that has no DexScreener market yet.
   */
  verified?: boolean;
  /**
   * Trust signals added by the scan route (`wallet-trust`). They are optional
   * because the scanner itself only reads balances — contract matching and
   * organic volume are a second, best-effort pass.
   */
  contractStatus?: "official" | "different" | "unknown";
  /** 24h organic DEX volume, when DexScreener answered for this contract. */
  organicVolumeUsd?: number;
  liquidityUsd?: number;
  /** Liquidity of the token's deepest single pool. */
  deepestPoolUsd?: number;
  /** Pools deep enough to call the token real. */
  deepLiquidity?: boolean;
  marketPairs?: number;
  washSuspected?: boolean;
  /** The scan route's "is this real?" verdict (see `wallet-trust`). */
  verification?: "verified" | "unverified" | "unknown";
  /** CoinMarketCap's id, name and slug for the coin this contract belongs to. */
  cmcId?: number;
  cmcName?: string;
  cmcSlug?: string;
  /** The contract is listed on CoinMarketCap and its ticker agrees. */
  cmcVerified?: boolean;
  /** Listed, but under a different ticker than the scan showed (a rename, or bait). */
  cmcSymbolMismatch?: boolean;
  /** USD price from CoinMarketCap, used only when nothing else priced the token. */
  cmcPriceUsd?: number;
};

export type WalletScanResult = {
  address: string;
  addressKind: WalletAddressKind;
  /** `auto`, or the chain id the scan was narrowed to (app or DeBank spelling). */
  chain: string;
  balances: ScannedWalletBalance[];
  /**
   * Where the balances came from: DeBank (one call, all EVM chains, prices
   * included), Blockscan / Etherscan V2 (chosen in the dialog, one keyed sweep
   * across the chains Etherscan indexes) or a direct read of the public RPCs and
   * explorers. The dialog shows this so it is obvious where the numbers came
   * from.
   */
  source: "debank" | "onchain" | "blockscan" | "moralis";
  /** Why DeBank was not used, when it was tried and failed. */
  sourceNote?: string;
  /**
   * DeBank refused the keyless routes and no `DEBANK_ACCESS_KEY` is set, so the
   * scan is running on the (much smaller) direct read. The dialog turns this
   * into an actionable hint instead of a scary error.
   */
  debankNeedsKey?: boolean;
  /**
   * How many holdings the direct read found that DeBank did not report. DeBank
   * covers the chains it indexes; the explorers see every ERC-20 on a chain, so
   * a non-zero count here means DeBank would have missed them.
   */
  directAdditions?: number;
  /**
   * Blockscan was the chosen source but no `ETHERSCAN_API_KEY` is configured, so
   * only the direct on-chain read contributed. The dialog turns this into an
   * actionable hint (get a key) instead of an empty wallet.
   */
  blockscanNeedsKey?: boolean;
  /** How many chains the Blockscan sweep ran out of time before asking. */
  blockscanSkippedChains?: number;
  /** Blockscan answered, but token holdings are a paid-plan endpoint. */
  blockscanProOnly?: boolean;
  /**
   * The key's plan has no holdings endpoint, so the tokens came from the free
   * transfer history (`tokentx` → `tokenbalance`) instead. Fewer than a full
   * sweep would see, but real balances rather than native only.
   */
  blockscanFreeFallback?: boolean;
  /** Contracts the free path could not read before its budget ran out. */
  blockscanFreeUnread?: number;
  /**
   * Moralis was the chosen source but no `MORALIS_API_KEY` is configured, so the
   * scan is running on the other sources. The dialog turns this into a hint.
   */
  moralisNeedsKey?: boolean;
  /** How many chains the Moralis sweep ran out of time before asking. */
  moralisSkippedChains?: number;
};

const REQUEST_TIMEOUT_MS = 7000;

/** Fallback reference USD prices when live exchange APIs are unreachable. */
const FALLBACK_PRICES_USD: Record<string, number> = {
  BTC: 88500,
  WBTC: 88500,
  BTCB: 88500,
  CBBTC: 88500,
  ETH: 2650,
  WETH: 2650,
  STETH: 2650,
  BNB: 620,
  SOL: 178,
  MSOL: 195,
  JITOSOL: 198,
  POL: 0.38,
  MATIC: 0.38,
  AVAX: 26.5,
  ARB: 0.75,
  OP: 1.45,
  LINK: 16.8,
  UNI: 8.9,
  AAVE: 185,
  PEPE: 0.00001,
  SHIB: 0.000018,
  JUP: 0.88,
  RAY: 2.6,
  BONK: 0.000022,
  WIF: 1.85,
  TRX: 0.23,
  USDT: 1,
  USDC: 1,
  DAI: 1,
};

type EvmTokenSpec = {
  symbol: string;
  name: string;
  contract: string;
  decimals: number;
};

type EvmChainSpec = {
  chain: Exclude<WalletChain, "auto" | "solana" | "bitcoin" | "tron">;
  label: string;
  rpcUrls: string[];
  nativeSymbol: string;
  nativeName: string;
  tokens: EvmTokenSpec[];
};

const EVM_CHAINS: EvmChainSpec[] = [
  {
    chain: "ethereum",
    label: "Ethereum",
    rpcUrls: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
    ],
    nativeSymbol: "ETH",
    nativeName: "Ethereum",
    tokens: [
      { symbol: "USDT", name: "Tether USD", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "USDC", name: "USD Coin", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "DAI", name: "Dai Stablecoin", contract: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      { symbol: "WBTC", name: "Wrapped BTC", contract: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      { symbol: "STETH", name: "Lido Staked Ether", contract: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18 },
      { symbol: "LINK", name: "Chainlink", contract: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
      { symbol: "UNI", name: "Uniswap", contract: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
      { symbol: "AAVE", name: "Aave", contract: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18 },
      { symbol: "PEPE", name: "Pepe", contract: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 },
      { symbol: "SHIB", name: "Shiba Inu", contract: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18 },
    ],
  },
  {
    chain: "bsc",
    label: "BNB Chain",
    rpcUrls: ["https://bsc-rpc.publicnode.com"],
    nativeSymbol: "BNB",
    nativeName: "BNB",
    tokens: [
      { symbol: "USDT", name: "Tether USD (BSC)", contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", name: "USD Coin (BSC)", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      { symbol: "BTCB", name: "Bitcoin BEP2", contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
      { symbol: "ETH", name: "Ethereum (BSC)", contract: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
    ],
  },
  {
    chain: "arbitrum",
    label: "Arbitrum",
    rpcUrls: ["https://arbitrum-one-rpc.publicnode.com"],
    nativeSymbol: "ETH",
    nativeName: "Ethereum (Arbitrum)",
    tokens: [
      { symbol: "USDT", name: "Tether USD (Arbitrum)", contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      { symbol: "USDC", name: "USD Coin (Arbitrum)", contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { symbol: "ARB", name: "Arbitrum", contract: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
      { symbol: "WBTC", name: "Wrapped BTC (Arbitrum)", contract: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
    ],
  },
  {
    chain: "base",
    label: "Base",
    rpcUrls: ["https://base-rpc.publicnode.com"],
    nativeSymbol: "ETH",
    nativeName: "Ethereum (Base)",
    tokens: [
      { symbol: "USDC", name: "USD Coin (Base)", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "CBBTC", name: "Coinbase Wrapped BTC", contract: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    ],
  },
  {
    chain: "polygon",
    label: "Polygon",
    rpcUrls: ["https://polygon-bor-rpc.publicnode.com"],
    nativeSymbol: "POL",
    nativeName: "Polygon (POL)",
    tokens: [
      { symbol: "USDT", name: "Tether USD (Polygon)", contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { symbol: "USDC", name: "USD Coin (Polygon)", contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      { symbol: "WETH", name: "Wrapped Ether (Polygon)", contract: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
    ],
  },
  {
    chain: "optimism",
    label: "Optimism",
    rpcUrls: ["https://optimism-rpc.publicnode.com"],
    nativeSymbol: "ETH",
    nativeName: "Ethereum (Optimism)",
    tokens: [
      { symbol: "USDT", name: "Tether USD (Optimism)", contract: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      { symbol: "USDC", name: "USD Coin (Optimism)", contract: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      { symbol: "OP", name: "Optimism", contract: "0x4200000000000000000000000000000000000042", decimals: 18 },
    ],
  },
  {
    chain: "avalanche",
    label: "Avalanche",
    rpcUrls: ["https://avalanche-c-chain-rpc.publicnode.com"],
    nativeSymbol: "AVAX",
    nativeName: "Avalanche",
    tokens: [
      { symbol: "USDT", name: "Tether USD (Avalanche)", contract: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
      { symbol: "USDC", name: "USD Coin (Avalanche)", contract: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    ],
  },
];

/**
 * Chains the direct read reaches through an explorer only.
 *
 * The RPC read needs a hand-written token list per chain, which is why it covers
 * a handful of chains. Discovery does not: Blockscout and Routescan report the
 * token *and* the balance, so the chains the chain dropdown offers but the RPC
 * list does not cover are still scanned — they just cannot read a native coin
 * balance. Without this, picking "zkSync" or "Linea" quietly returned nothing.
 */
const EXPLORER_CHAINS: Array<{ chain: string; label: string }> = [
  { chain: "zksync", label: WALLET_CHAIN_LABELS.zksync },
  { chain: "linea", label: WALLET_CHAIN_LABELS.linea },
  { chain: "scroll", label: WALLET_CHAIN_LABELS.scroll },
  { chain: "mantle", label: WALLET_CHAIN_LABELS.mantle },
  { chain: "blast", label: WALLET_CHAIN_LABELS.blast },
  { chain: "fantom", label: WALLET_CHAIN_LABELS.fantom },
  { chain: "gnosis", label: WALLET_CHAIN_LABELS.gnosis },
  { chain: "cronos", label: WALLET_CHAIN_LABELS.cronos },
  // Chains DeBank indexes that this app's dropdown does not list (yet).
  { chain: "zora", label: "Zora" },
  { chain: "sonic", label: "Sonic" },
  { chain: "celo", label: "Celo" },
  { chain: "mode", label: "Mode" },
  { chain: "unichain", label: "Unichain" },
  { chain: "berachain", label: "Berachain" },
];

/**
 * Reads one explorer-only chain: every ERC-20 the wallet holds, with the balance
 * the explorer reports. No native-coin balance, because that needs an RPC.
 */
async function scanOneExplorerChain(
  spec: { chain: string; label: string },
  address: string,
): Promise<Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>> {
  const tokens = await discoverChainTokens(spec.chain, address);
  return tokens.map((token) => ({
    id: `${spec.chain}:${token.symbol}:${token.contract}`,
    symbol: token.symbol,
    name: token.name,
    chain: spec.chain,
    chainLabel: spec.label,
    quantity: token.quantity,
    category: token.stablecoin ? ("stablecoin" as const) : ("volatile" as const),
    contract: token.contract,
  }));
}

const SOLANA_MINTS: Record<string, { symbol: string; name: string }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin (Solana)" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether USD (Solana)" },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", name: "Jupiter" },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", name: "Bonk" },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "WIF", name: "dogwifhat" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", name: "Raydium" },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "MSOL", name: "Marinade Staked SOL" },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "JITOSOL", name: "Jito Staked SOL" },
};

export function formatUnitsFromHex(hexValue: unknown, decimals: number): number {
  if (typeof hexValue !== "string" || !hexValue.startsWith("0x")) return 0;
  const cleaned = hexValue.slice(2);
  if (!cleaned || /^0+$/.test(cleaned)) return 0;
  try {
    const raw = BigInt(`0x${cleaned}`);
    if (raw <= BigInt(0)) return 0;
    let base = BigInt(1);
    const ten = BigInt(10);
    for (let i = 0; i < decimals; i++) {
      base *= ten;
    }
    const whole = Number(raw / base);
    const fraction = Number(raw % base) / Number(base);
    const total = whole + fraction;
    return Number.isFinite(total) && total > 0 ? Number(total.toFixed(8)) : 0;
  } catch {
    return 0;
  }
}

export function encodeBalanceOfCall(evmAddress: string): string {
  const clean = evmAddress.trim().replace(/^0x/i, "").toLowerCase();
  return `0x70a08231${clean.padStart(64, "0")}`;
}

/**
 * Every ERC-20 a wallet holds on one chain, from whichever explorer answers.
 *
 * Blockscout first (rich data, many big chains), then Routescan — which covers
 * chains with no public Blockscout instance and steps in when Blockscout is
 * rate-limited. Both are keyless and both are best effort, so this returns `[]`
 * rather than failing a scan.
 */
async function discoverChainTokens(chain: string, address: string): Promise<DiscoveredToken[]> {
  try {
    const blockscout = await fetchBlockscoutTokens(chain, address);
    if (blockscout.length > 0) return blockscout;
  } catch {
    // Fall through to Routescan.
  }
  try {
    return await fetchRoutescanTokens(chain, address);
  } catch {
    return [];
  }
}

/**
 * Reads a chain: the native balance plus the known tickers over RPC, and every
 * other ERC-20 the wallet holds via an explorer's account API.
 *
 * RPC alone can only answer "how much of *this* token do you hold", so a wallet
 * would otherwise show only the hand-listed tickers. Blockscout contributes the
 * tokens this file has never heard of — which is most of them.
 */
async function scanOneEvmChain(
  spec: EvmChainSpec,
  address: string,
): Promise<Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>> {
  const [known, discovered] = await Promise.all([
    scanEvmChainRpc(spec, address),
    discoverChainTokens(spec.chain, address),
  ]);

  const seen = new Set(
    known.map((item) => item.contract?.toLowerCase()).filter((value): value is string => Boolean(value)),
  );
  const extra: typeof known = [];
  for (const token of discovered) {
    const key = token.contract.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({
      id: `${spec.chain}:${token.symbol}:${token.contract}`,
      symbol: token.symbol,
      name: token.name,
      chain: spec.chain,
      chainLabel: spec.label,
      quantity: token.quantity,
      category: token.stablecoin ? "stablecoin" : "volatile",
      contract: token.contract,
      ...(token.verified ? { verified: true } : {}),
    });
  }

  return [...known, ...extra];
}

async function scanEvmChainRpc(
  spec: EvmChainSpec,
  address: string,
): Promise<Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>> {
  const callData = encodeBalanceOfCall(address);
  const batchPayload = [
    {
      jsonrpc: "2.0",
      id: 0,
      method: "eth_getBalance",
      params: [address, "latest"],
    },
    ...spec.tokens.map((token, idx) => ({
      jsonrpc: "2.0",
      id: idx + 1,
      method: "eth_call",
      params: [{ to: token.contract, data: callData }, "latest"],
    })),
  ];

  let responses: Array<{ id?: number; result?: unknown }> | null = null;
  for (const rpcUrl of spec.rpcUrls) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchPayload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json)) {
        responses = json;
        break;
      }
    } catch {
      // Try next RPC URL for this chain.
    }
  }

  if (!responses) return [];

  const byId = new Map<number, unknown>();
  for (const item of responses) {
    if (typeof item?.id === "number") {
      byId.set(item.id, item.result);
    }
  }

  const found: Array<Omit<ScannedWalletBalance, "price" | "valueUsd">> = [];
  const nativeQty = formatUnitsFromHex(byId.get(0), 18);
  if (nativeQty > 0) {
    found.push({
      id: `${spec.chain}:${spec.nativeSymbol}`,
      symbol: spec.nativeSymbol,
      name: spec.nativeName,
      chain: spec.chain,
      chainLabel: spec.label,
      quantity: nativeQty,
      category: STABLECOIN_SYMBOLS.has(spec.nativeSymbol) ? "stablecoin" : "volatile",
      contract: null,
    });
  }

  spec.tokens.forEach((token, idx) => {
    const qty = formatUnitsFromHex(byId.get(idx + 1), token.decimals);
    if (qty > 0) {
      found.push({
        id: `${spec.chain}:${token.symbol}:${token.contract}`,
        symbol: token.symbol,
        name: token.name,
        chain: spec.chain,
        chainLabel: spec.label,
        quantity: qty,
        category: STABLECOIN_SYMBOLS.has(token.symbol) ? "stablecoin" : "volatile",
        contract: token.contract,
      });
    }
  });

  return found;
}

async function scanSolanaWallet(
  address: string,
): Promise<Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>> {
  const rpcUrls = [
    "https://solana-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com",
  ];
  const batchPayload = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address],
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "getTokenAccountsByOwner",
      params: [
        address,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ],
    },
  ];

  let responses: Array<{ id?: number; result?: any }> | null = null;
  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchPayload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json)) {
        responses = json;
        break;
      }
    } catch {
      // Try fallback Solana RPC.
    }
  }

  if (!responses) return [];

  const found: Array<Omit<ScannedWalletBalance, "price" | "valueUsd">> = [];
  const balEntry = responses.find((r) => r?.id === 1);
  const lamports = Number(balEntry?.result?.value ?? 0);
  if (Number.isFinite(lamports) && lamports > 0) {
    const solQty = Number((lamports / 1e9).toFixed(8));
    if (solQty > 0) {
      found.push({
        id: "solana:SOL",
        symbol: "SOL",
        name: "Solana",
        chain: "solana",
        chainLabel: "Solana",
        quantity: solQty,
        category: "volatile",
        contract: null,
      });
    }
  }

  const tokensEntry = responses.find((r) => r?.id === 2);
  const accounts = Array.isArray(tokensEntry?.result?.value)
    ? tokensEntry.result.value
    : [];

  for (const acc of accounts) {
    const info = acc?.account?.data?.parsed?.info;
    const mint = String(info?.mint ?? "");
    const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
    if (!mint || !Number.isFinite(uiAmount) || uiAmount <= 0) continue;
    const known = SOLANA_MINTS[mint];
    if (!known) continue;
    found.push({
      id: `solana:${known.symbol}:${mint}`,
      symbol: known.symbol,
      name: known.name,
      chain: "solana",
      chainLabel: "Solana",
      quantity: Number(uiAmount.toFixed(8)),
      category: STABLECOIN_SYMBOLS.has(known.symbol) ? "stablecoin" : "volatile",
      contract: mint,
    });
  }

  return found;
}

async function scanBitcoinWallet(
  address: string,
): Promise<Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>> {
  const urls = [
    `https://mempool.space/api/address/${encodeURIComponent(address)}`,
    `https://blockstream.info/api/address/${encodeURIComponent(address)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
        mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
      };
      const confirmed =
        Number(data?.chain_stats?.funded_txo_sum ?? 0) -
        Number(data?.chain_stats?.spent_txo_sum ?? 0);
      const mempool =
        Number(data?.mempool_stats?.funded_txo_sum ?? 0) -
        Number(data?.mempool_stats?.spent_txo_sum ?? 0);
      const sats = confirmed + mempool;
      if (Number.isFinite(sats) && sats > 0) {
        const btcQty = Number((sats / 1e8).toFixed(8));
        if (btcQty > 0) {
          return [
            {
              id: "bitcoin:BTC",
              symbol: "BTC",
              name: "Bitcoin",
              chain: "bitcoin",
              chainLabel: "Bitcoin",
              quantity: btcQty,
              category: "volatile",
              contract: null,
            },
          ];
        }
      }
      return [];
    } catch {
      // Try fallback Bitcoin API.
    }
  }
  return [];
}

async function scanTronWallet(
  address: string,
): Promise<Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>> {
  try {
    const res = await fetch(
      `https://apilist.tronscanapi.com/api/accountv2?address=${encodeURIComponent(address)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      balance?: number;
      withPriceTokens?: Array<{
        tokenAbbr?: string;
        tokenName?: string;
        tokenId?: string;
        balance?: string;
        tokenDecimal?: number;
      }>;
    };
    const found: Array<Omit<ScannedWalletBalance, "price" | "valueUsd">> = [];
    const sun = Number(data?.balance ?? 0);
    if (Number.isFinite(sun) && sun > 0) {
      const trxQty = Number((sun / 1e6).toFixed(6));
      if (trxQty > 0) {
        found.push({
          id: "tron:TRX",
          symbol: "TRX",
          name: "TRON",
          chain: "tron",
          chainLabel: "Tron",
          quantity: trxQty,
          category: "volatile",
          contract: null,
        });
      }
    }

    const tokens = Array.isArray(data?.withPriceTokens) ? data.withPriceTokens : [];
    for (const token of tokens) {
      const symbol = String(token?.tokenAbbr ?? "").trim().toUpperCase();
      if (symbol !== "USDT" && symbol !== "USDC") continue;
      const decimals = Number(token?.tokenDecimal ?? 6);
      const rawBal = Number(token?.balance ?? 0);
      if (!Number.isFinite(rawBal) || rawBal <= 0) continue;
      const qty = Number((rawBal / 10 ** decimals).toFixed(6));
      if (qty > 0) {
        found.push({
          id: `tron:${symbol}:${token?.tokenId ?? symbol}`,
          symbol,
          name: `${symbol} (TRC-20)`,
          chain: "tron",
          chainLabel: "Tron",
          quantity: qty,
          category: "stablecoin",
          contract: String(token?.tokenId ?? ""),
        });
      }
    }
    return found;
  } catch {
    return [];
  }
}

/** DeBank returns prices; only the unpriced leftovers need a lookup. */
function fromDebank(balance: DebankBalance): ScannedWalletBalance {
  return {
    id: balance.id,
    symbol: balance.symbol,
    name: balance.name,
    chain: balance.chain,
    chainLabel: balance.chainLabel,
    quantity: balance.quantity,
    price: balance.price,
    valueUsd: balance.valueUsd,
    priced: balance.price > 0 || balance.valueUsd > 0,
    category: balance.category,
    contract: balance.contract,
    ...(balance.logoUrl ? { logoUrl: balance.logoUrl } : {}),
    ...(balance.spam ? { spam: true } : {}),
    ...(balance.verified ? { verified: true } : {}),
  };
}

async function resolveSymbolPriceUsd(symbol: string): Promise<number> {
  const upper = symbol.trim().toUpperCase();
  if (STABLECOIN_SYMBOLS.has(upper)) return 1;

  // Map wrapped symbols to their underlying ticker for exchange price lookup.
  const lookupSymbol =
    upper === "WBTC" || upper === "BTCB" || upper === "CBBTC"
      ? "BTC"
      : upper === "WETH" || upper === "STETH"
        ? "ETH"
        : upper === "MSOL" || upper === "JITOSOL"
          ? "SOL"
          : upper;

  try {
    const { price } = await fetchPreferredMarketPrice("", lookupSymbol, "USDT");
    if (Number.isFinite(price) && price > 0) return price;
  } catch {
    // Fall back to reference price below.
  }
  return FALLBACK_PRICES_USD[upper] ?? FALLBACK_PRICES_USD[lookupSymbol] ?? 0;
}

/**
 * Which index is asked for the token list.
 *
 * `auto` is the default and unchanged behaviour: DeBank plus the direct read.
 * `blockscan` asks Etherscan V2 — the API behind blockscan.com — instead, and
 * still merges in the direct read so a keyed rate limit or a paid-plan endpoint
 * can never leave the scan with nothing.
 */
/** A source balance in the shape the pricing pass wants: no price, no value. */
function asUnpriced(balance: DebankBalance): Omit<ScannedWalletBalance, "price" | "valueUsd"> {
  return {
    id: balance.id,
    symbol: balance.symbol,
    name: balance.name,
    chain: balance.chain,
    chainLabel: balance.chainLabel,
    quantity: balance.quantity,
    category: balance.category,
    contract: balance.contract,
    ...(balance.logoUrl ? { logoUrl: balance.logoUrl } : {}),
    ...(balance.spam ? { spam: true } : {}),
    ...(balance.verified ? { verified: true } : {}),
  };
}

/**
 * The index's balances first (it has live prices), then whatever only the direct
 * read saw — added, priced from the market APIs, and sorted together.
 *
 * An index does not always price what it returns: Blockscan's free
 * transfer-history path reports balances only. Those rows go through the same
 * market lookup as the direct read, so a real token is never shown — or filtered
 * away — as $0 dust.
 */
async function mergeWithDirect(
  primary: readonly DebankBalance[],
  directRaw: ReadonlyArray<Omit<ScannedWalletBalance, "price" | "valueUsd">>,
): Promise<{ balances: ScannedWalletBalance[]; extra: number }> {
  const known = new Set(
    primary.map((balance) => balanceKey(balance.chain, balance.contract, balance.symbol)),
  );
  const extra = directRaw.filter(
    (item) => !known.has(balanceKey(item.chain, item.contract, item.symbol)),
  );
  const unpriced = primary.filter((balance) => !(balance.price > 0));
  const pricedPrimary = unpriced.length
    ? new Map(
        (await priceBalances(unpriced.map(asUnpriced), primary)).map((balance) => [
          balance.id,
          balance,
        ]),
      )
    : null;
  const priced = await priceBalances(extra, primary);
  const balances = [
    ...primary.map((balance) => pricedPrimary?.get(balance.id) ?? fromDebank(balance)),
    ...priced,
  ].sort((a, b) => b.valueUsd - a.valueUsd || b.quantity - a.quantity);
  return { balances, extra: extra.length };
}

export type WalletScanSource = "auto" | "blockscan" | "moralis";

/**
 * API keys for the indexers, as saved in the app (`scanner-keys`). Anything left
 * out falls back to the environment, so a scan works with either setup — or with
 * no keys at all, in which case the chains are read directly.
 */
export type WalletScanKeys = {
  debank?: string;
  /** Etherscan V2, the API behind Blockscan. */
  blockscan?: string;
  moralis?: string;
};

export async function scanWalletAddress(
  rawAddress: string,
  chainFilter: string = "auto",
  options: { source?: WalletScanSource; keys?: WalletScanKeys } = {},
): Promise<WalletScanResult> {
  const source: WalletScanSource =
    options.source === "blockscan" || options.source === "moralis" ? options.source : "auto";
  const requestedChain = normaliseWalletChain(chainFilter);
  const address = rawAddress.trim();
  const addressKind = detectWalletAddressKind(address);
  if (!addressKind) {
    throw new Error(
      "Enter a valid wallet address (0x… for Ethereum/EVM, Solana Base58, bc1… for Bitcoin, or T… for Tron).",
    );
  }

  const isEvm = addressKind === "evm";
  const filtered = requestedChain !== "auto";
  const chainsToScan =
    filtered && EVM_CHAINS.some((c) => c.chain === requestedChain)
      ? EVM_CHAINS.filter((c) => c.chain === requestedChain)
      : filtered
        ? []
        : EVM_CHAINS;
  const explorerChainsToScan =
    filtered && EXPLORER_CHAINS.some((c) => c.chain === requestedChain)
      ? EXPLORER_CHAINS.filter((c) => c.chain === requestedChain)
      : filtered
        ? []
        : EXPLORER_CHAINS;

  if (source !== "auto" && !isEvm) {
    throw new Error(
      "Blockscan and Moralis only index EVM addresses — scan Solana, Bitcoin and Tron with the default scan.",
    );
  }

  /**
   * The index and the direct read run **together**, and their results are
   * merged.
   *
   * Running only one of them is what used to lose tokens: the index answers
   * quickly with prices but only covers the chains it knows and filters, and the
   * direct read sees every ERC-20 on a chain but knows fewer chains. Both run in
   * parallel so a scan takes as long as the slower one, not both.
   */
  /**
   * Moralis is preferred in a default scan whenever a key is configured: it is
   * the only source that labels a token `possible_spam`, so the junk is counted
   * as spam instead of having to be spotted by its name.
   */
  /**
   * Keys come from the app settings first (saved in the scan dialog) and from
   * the environment otherwise — see `scanner-keys`.
   */
  const debankKey = (options.keys?.debank ?? debankAccessKey()).trim();
  const blockscanKey = (options.keys?.blockscan ?? blockscanApiKey()).trim();
  const moralisKey = (options.keys?.moralis ?? moralisApiKey()).trim();

  const wantsMoralis =
    isEvm && (source === "moralis" || (source === "auto" && moralisKey !== ""));

  const [debank, blockscan, moralis, directRaw] = await Promise.all([
    isEvm && source === "auto"
      ? fetchDebankBalances(address, requestedChain, { accessKey: debankKey })
      : Promise.resolve(null),
    isEvm && source === "blockscan"
      ? fetchBlockscanBalances(address, { chainFilter: requestedChain, apiKey: blockscanKey })
      : Promise.resolve(null),
    wantsMoralis
      ? fetchMoralisBalances(address, { chainFilter: requestedChain, apiKey: moralisKey })
      : Promise.resolve(null),
    isEvm
      ? Promise.all([
          ...chainsToScan.map((spec) => scanOneEvmChain(spec, address)),
          ...explorerChainsToScan.map((spec) => scanOneExplorerChain(spec, address)),
        ]).then((perChain) => perChain.flat())
      : addressKind === "solana"
        ? scanSolanaWallet(address)
        : addressKind === "bitcoin"
          ? scanBitcoinWallet(address)
          : addressKind === "tron"
            ? scanTronWallet(address)
            : Promise.resolve([]),
  ]);

  /**
   * Blockscan is the source the user picked, so its answer is the spine of the
   * result — but the direct read is merged in rather than replaced, because
   * Etherscan can refuse a whole sweep (no key, a free key on a PRO endpoint,
   * rate limit) and "nothing found" must never be the answer to that.
   */
  if (blockscan) {
    const { balances, extra } = await mergeWithDirect(blockscan.balances, directRaw);
    return {
      address,
      addressKind,
      chain: requestedChain,
      balances,
      source: "blockscan",
      ...(blockscan.error ? { sourceNote: blockscan.error } : {}),
      ...(blockscan.needsKey ? { blockscanNeedsKey: true } : {}),
      ...(blockscan.proOnly ? { blockscanProOnly: true } : {}),
      ...(blockscan.freeFallbackChains?.length ? { blockscanFreeFallback: true } : {}),
      ...(blockscan.freeUnreadContracts ? { blockscanFreeUnread: blockscan.freeUnreadContracts } : {}),
      ...(blockscan.skippedChains.length > 0
        ? { blockscanSkippedChains: blockscan.skippedChains.length }
        : {}),
      ...(extra > 0 ? { directAdditions: extra } : {}),
    };
  }

  /**
   * Moralis answers first when it was asked: its spam verdict is the whole reason
   * to use it. A default scan only uses it when it actually returned balances, so
   * a missing or rate-limited key still lets DeBank answer.
   */
  if (moralis && (moralis.balances.length > 0 || source === "moralis")) {
    const { balances, extra } = await mergeWithDirect(moralis.balances, directRaw);
    return {
      address,
      addressKind,
      chain: requestedChain,
      balances,
      source: "moralis",
      ...(moralis.error ? { sourceNote: moralis.error } : {}),
      ...(moralis.needsKey ? { moralisNeedsKey: true } : {}),
      ...(moralis.skippedChains.length > 0
        ? { moralisSkippedChains: moralis.skippedChains.length }
        : {}),
      ...(extra > 0 ? { directAdditions: extra } : {}),
    };
  }

  const debankBalances: DebankBalance[] =
    debank?.ok && debank.balances.length > 0 ? debank.balances : [];
  const sourceNote = debank && debankBalances.length === 0 ? (debank.error ?? undefined) : undefined;
  const debankNeedsKey = Boolean(debank && debankBalances.length === 0 && debank.needsAccessKey);

  if (debankBalances.length > 0) {
    // DeBank's numbers win for the tokens it knows (it has live prices), and
    // everything it missed — other chains, filtered or unlisted tokens — is
    // added from the direct read and priced here.
    const { balances, extra } = await mergeWithDirect(debankBalances, directRaw);
    return {
      address,
      addressKind,
      chain: requestedChain,
      balances,
      source: "debank",
      ...(extra > 0 ? { directAdditions: extra } : {}),
    };
  }

  /**
   * DeBank could not answer at all (its keyless routes are blocked) — if an
   * Etherscan key is configured, Blockscan takes over for this scan rather than
   * leaving the user with the much smaller direct read. Only for the default
   * source: a Blockscan scan has already been tried above.
   */
  if (source === "auto" && blockscanKey !== "" && debankBalances.length === 0) {
    const fallback = await fetchBlockscanBalances(address, {
      chainFilter: requestedChain,
      apiKey: blockscanKey,
    });
    if (fallback.ok && fallback.balances.length > 0) {
      const { balances, extra } = await mergeWithDirect(fallback.balances, directRaw);
      return {
        address,
        addressKind,
        chain: requestedChain,
        balances,
        source: "blockscan",
        sourceNote: "DeBank had no answer, so this scan used Blockscan (Etherscan) instead.",
        ...(fallback.skippedChains.length > 0
          ? { blockscanSkippedChains: fallback.skippedChains.length }
          : {}),
        ...(fallback.freeFallbackChains?.length ? { blockscanFreeFallback: true } : {}),
        ...(fallback.proOnly ? { blockscanProOnly: true } : {}),
        ...(extra > 0 ? { directAdditions: extra } : {}),
      };
    }
  }

  const balances = await priceBalances(directRaw);

  return {
    address,
    addressKind,
    chain: requestedChain,
    balances,
    source: "onchain",
    ...(sourceNote ? { sourceNote } : {}),
    ...(debankNeedsKey ? { debankNeedsKey: true } : {}),
  };
}

/**
 * Identity of one holding across sources: chain + contract, or chain + symbol
 * for a native coin (which has no contract).
 */
function balanceKey(chain: string, contract: string | null, symbol: string): string {
  const chainKey = chain.trim().toLowerCase();
  return contract
    ? `${chainKey}:${contract.toLowerCase()}`
    : `${chainKey}:sym:${symbol.toUpperCase()}`;
}

/**
 * Fills in the USD price of holdings that DeBank did not price, reusing DeBank's
 * price for a symbol it already quoted so one token never shows two prices.
 */
async function priceBalances(
  rawBalances: Array<Omit<ScannedWalletBalance, "price" | "valueUsd">>,
  priced: readonly DebankBalance[] = [],
): Promise<ScannedWalletBalance[]> {
  // Only a real price is reused: a zero from an index that could not price the
  // token must not stop the market lookup from trying.
  const alreadyPriced = new Map(
    priced
      .filter((balance) => Number.isFinite(balance.price) && balance.price > 0)
      .map((balance) => [balance.symbol.toUpperCase(), balance.price]),
  );
  const needed = [
    ...new Set(
      rawBalances
        .map((balance) => balance.symbol.toUpperCase())
        .filter((symbol) => !alreadyPriced.has(symbol)),
    ),
  ];
  const entries = await Promise.all(
    needed.map(async (symbol) => [symbol, await resolveSymbolPriceUsd(symbol)] as const),
  );
  const prices = new Map<string, number>([...alreadyPriced, ...entries]);

  return rawBalances
    .map((item) => {
      const price = prices.get(item.symbol.toUpperCase()) ?? 0;
      return {
        ...item,
        price,
        valueUsd: Number((item.quantity * price).toFixed(2)),
        priced: price > 0,
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd || b.quantity - a.quantity);
}
