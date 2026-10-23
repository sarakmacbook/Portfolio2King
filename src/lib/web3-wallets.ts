export const WEB3_WALLET_IDS = [
  "metamask",
  "phantom",
  "okx-web3",
  "trust-wallet",
  "rabby",
  "coinbase-wallet",
  "binance-web3",
  "bybit-web3",
  "solflare",
  "backpack",
  "ledger",
  "rainbow",
] as const;

export type Web3WalletId = (typeof WEB3_WALLET_IDS)[number];

export type Web3Wallet = {
  id: Web3WalletId;
  name: string;
  short: string;
  color: string;
  keywords: string[];
};

export const WEB3_WALLETS: Web3Wallet[] = [
  {
    id: "metamask",
    name: "MetaMask",
    short: "MM",
    color: "#f6851b",
    keywords: ["metamask", "meta mask"],
  },
  {
    id: "phantom",
    name: "Phantom",
    short: "PH",
    color: "#7c65f6",
    keywords: ["phantom", "phantom wallet"],
  },
  {
    id: "okx-web3",
    name: "OKX Web3",
    short: "OKX",
    color: "#111827",
    keywords: ["okx web3", "okx wallet", "okx-web3", "okxweb3"],
  },
  {
    id: "trust-wallet",
    name: "Trust Wallet",
    short: "TW",
    color: "#0500ff",
    keywords: ["trust wallet", "trustwallet", "trust-wallet"],
  },
  {
    id: "rabby",
    name: "Rabby Wallet",
    short: "RB",
    color: "#7084ff",
    keywords: ["rabby", "rabby wallet"],
  },
  {
    id: "coinbase-wallet",
    name: "Coinbase Wallet",
    short: "CBW",
    color: "#0052ff",
    keywords: ["coinbase wallet", "coinbase web3", "base wallet"],
  },
  {
    id: "binance-web3",
    name: "Binance Web3",
    short: "BNB",
    color: "#181a20",
    keywords: ["binance web3", "binance wallet", "binance-web3"],
  },
  {
    id: "bybit-web3",
    name: "Bybit Web3",
    short: "BYB",
    color: "#17181e",
    keywords: ["bybit web3", "bybit wallet", "bybit-web3"],
  },
  {
    id: "solflare",
    name: "Solflare",
    short: "SF",
    color: "#fc7227",
    keywords: ["solflare", "solflare wallet"],
  },
  {
    id: "backpack",
    name: "Backpack",
    short: "BP",
    color: "#e33e3f",
    keywords: ["backpack", "backpack wallet"],
  },
  {
    id: "ledger",
    name: "Ledger",
    short: "LDG",
    color: "#0f172a",
    keywords: ["ledger", "ledger live", "ledger nano"],
  },
  {
    id: "rainbow",
    name: "Rainbow",
    short: "RBW",
    color: "#1e293b",
    keywords: ["rainbow wallet", "rainbow web3"],
  },
];

const BY_ID = new Map<Web3WalletId, Web3Wallet>(
  WEB3_WALLETS.map((wallet) => [wallet.id, wallet]),
);

export function isWeb3WalletId(value: unknown): value is Web3WalletId {
  return typeof value === "string" && BY_ID.has(value as Web3WalletId);
}

export function parseWeb3WalletId(value: unknown): Web3WalletId | "" {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  return isWeb3WalletId(trimmed) ? trimmed : "";
}

export function getWeb3Wallet(id: unknown): Web3Wallet | undefined {
  const parsed = parseWeb3WalletId(id);
  return parsed ? BY_ID.get(parsed) : undefined;
}

/**
 * Resolves a Web3 wallet from an explicit wallet id first, or from the asset's
 * name/symbol when a holding is named after a Web3 wallet (e.g. "MetaMask",
 * "Phantom", "OKX Web3", "SOL (Phantom)").
 */
export function detectWeb3Wallet(
  name?: string | null,
  symbol?: string | null,
  explicitWallet?: string | null,
): Web3Wallet | undefined {
  if (explicitWallet) {
    const direct = getWeb3Wallet(explicitWallet);
    if (direct) return direct;
  }

  const haystacks = [name ?? "", symbol ?? ""]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (haystacks.length === 0) return undefined;

  for (const text of haystacks) {
    for (const wallet of WEB3_WALLETS) {
      if (text === wallet.id || text === wallet.name.toLowerCase()) {
        return wallet;
      }
      for (const kw of wallet.keywords) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
        if (re.test(text)) {
          return wallet;
        }
      }
    }
  }
  return undefined;
}
