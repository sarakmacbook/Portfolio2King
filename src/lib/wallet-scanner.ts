import type { CryptoCategory } from "@/db/schema";
import { fetchPreferredMarketPrice } from "@/lib/market-prices";

export const WALLET_CHAINS = [
  "auto",
  "ethereum",
  "bsc",
  "arbitrum",
  "base",
  "polygon",
  "optimism",
  "avalanche",
  "solana",
  "bitcoin",
  "tron",
] as const;

export type WalletChain = (typeof WALLET_CHAINS)[number];

export const WALLET_CHAIN_LABELS: Record<WalletChain, string> = {
  auto: "Auto-detect",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  arbitrum: "Arbitrum",
  base: "Base",
  polygon: "Polygon",
  optimism: "Optimism",
  avalanche: "Avalanche",
  solana: "Solana",
  bitcoin: "Bitcoin",
  tron: "Tron",
};

export type WalletAddressKind = "evm" | "solana" | "bitcoin" | "tron";

export type ScannedWalletBalance = {
  id: string;
  symbol: string;
  name: string;
  chain: Exclude<WalletChain, "auto">;
  chainLabel: string;
  quantity: number;
  price: number;
  valueUsd: number;
  category: CryptoCategory;
  contract: string | null;
};

export type WalletScanResult = {
  address: string;
  addressKind: WalletAddressKind;
  chain: WalletChain;
  balances: ScannedWalletBalance[];
};

const REQUEST_TIMEOUT_MS = 7000;

const STABLECOIN_SYMBOLS = new Set([
  "USDT",
  "USDC",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDE",
  "PYUSD",
  "USDD",
  "FRAX",
]);

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

export function detectWalletAddressKind(rawAddress: string): WalletAddressKind | null {
  const addr = rawAddress.trim();
  if (!addr) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return "evm";
  if (/^(bc1[a-zA-HJ-NP-Z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(addr)) {
    return "bitcoin";
  }
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
    return "tron";
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
    return "solana";
  }
  return null;
}

export function isValidWalletChain(value: unknown): value is WalletChain {
  return typeof value === "string" && (WALLET_CHAINS as readonly string[]).includes(value);
}

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

async function scanOneEvmChain(
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

export async function scanWalletAddress(
  rawAddress: string,
  requestedChain: WalletChain = "auto",
): Promise<WalletScanResult> {
  const address = rawAddress.trim();
  const addressKind = detectWalletAddressKind(address);
  if (!addressKind) {
    throw new Error(
      "Enter a valid wallet address (0x… for Ethereum/EVM, Solana Base58, bc1… for Bitcoin, or T… for Tron).",
    );
  }

  let rawBalances: Array<Omit<ScannedWalletBalance, "price" | "valueUsd">> = [];

  if (addressKind === "evm") {
    const chainsToScan =
      requestedChain !== "auto" &&
      EVM_CHAINS.some((c) => c.chain === requestedChain)
        ? EVM_CHAINS.filter((c) => c.chain === requestedChain)
        : EVM_CHAINS;
    const perChain = await Promise.all(
      chainsToScan.map((spec) => scanOneEvmChain(spec, address)),
    );
    rawBalances = perChain.flat();
  } else if (addressKind === "solana") {
    rawBalances = await scanSolanaWallet(address);
  } else if (addressKind === "bitcoin") {
    rawBalances = await scanBitcoinWallet(address);
  } else if (addressKind === "tron") {
    rawBalances = await scanTronWallet(address);
  }

  // Price unique symbols in parallel.
  const uniqueSymbols = [...new Set(rawBalances.map((b) => b.symbol.toUpperCase()))];
  const priceEntries = await Promise.all(
    uniqueSymbols.map(async (sym) => [sym, await resolveSymbolPriceUsd(sym)] as const),
  );
  const priceMap = new Map<string, number>(priceEntries);

  const balances: ScannedWalletBalance[] = rawBalances
    .map((item) => {
      const price = priceMap.get(item.symbol.toUpperCase()) ?? 0;
      const valueUsd = Number((item.quantity * price).toFixed(2));
      return {
        ...item,
        price,
        valueUsd,
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd || b.quantity - a.quantity);

  return {
    address,
    addressKind,
    chain: requestedChain,
    balances,
  };
}
