/**
 * The chains a wallet address can be scanned on, and the address formats the
 * scanner understands.
 *
 * Kept apart from `wallet-scanner` (which does the network work) so the DeBank
 * client can share the same vocabulary without importing the scanner back.
 */

export const WALLET_CHAINS = [
  "auto",
  "ethereum",
  "bsc",
  "arbitrum",
  "base",
  "polygon",
  "optimism",
  "avalanche",
  "zksync",
  "linea",
  "scroll",
  "mantle",
  "blast",
  "fantom",
  "gnosis",
  "cronos",
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
  zksync: "zkSync",
  linea: "Linea",
  scroll: "Scroll",
  mantle: "Mantle",
  blast: "Blast",
  fantom: "Fantom",
  gnosis: "Gnosis",
  cronos: "Cronos",
  solana: "Solana",
  bitcoin: "Bitcoin",
  tron: "Tron",
};

export type WalletAddressKind = "evm" | "solana" | "bitcoin" | "tron";

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
