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
  auto: "All chains (DeBank)",
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

/**
 * Turns whatever the client sent into a chain filter.
 *
 * The list above is only what this app can read *by itself*; DeBank covers far
 * more, so any well-formed chain id is accepted here — `sonic`, `zora`, or a
 * chain that did not exist when this shipped. Anything unusable becomes `auto`
 * (every chain), which is always safe.
 */
export function normaliseWalletChain(value: unknown): string {
  if (typeof value !== "string") return "auto";
  const key = value.trim().toLowerCase();
  if (!key || key === "auto") return "auto";
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(key) ? key : "auto";
}

/**
 * A wallet address trimmed to something a human can read — `0x1234…abcd` — and,
 * because a folder name allows 28 characters, the default name for the folder a
 * wallet import is filed into. Short addresses are returned untouched.
 */
export function shortWalletAddress(rawAddress: string): string {
  const address = rawAddress.trim();
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Every chain DeBank's portfolio API indexes, keyed by the id DeBank uses.
 *
 * DeBank covers 100+ EVM chains and adds new ones without notice, so this table
 * is deliberately a *hint*, not a gate: a chain id that is missing here is still
 * scanned, listed and imported — the scan only uses this map to print a nicer
 * label than `AERO`. When it meets an id it does not know, the DeBank client
 * asks `/v1/chain/list` once and caches the names DeBank itself reports.
 */
export const DEBANK_CHAIN_LABELS: Record<string, string> = {
  eth: "Ethereum",
  bsc: "BNB Chain",
  arb: "Arbitrum",
  base: "Base",
  matic: "Polygon",
  op: "Optimism",
  avax: "Avalanche",
  era: "zkSync Era",
  linea: "Linea",
  scrl: "Scroll",
  mnt: "Mantle",
  blast: "Blast",
  ftm: "Fantom",
  sonic: "Sonic",
  xdai: "Gnosis Chain",
  cro: "Cronos",
  celo: "Celo",
  metis: "Metis",
  manta: "Manta Pacific",
  mode: "Mode",
  taiko: "Taiko",
  klay: "Kaia",
  merlin: "Merlin",
  b2: "B²",
  core: "CORE",
  zora: "Zora",
  opbnb: "opBNB",
  nova: "Arbitrum Nova",
  aurora: "Aurora",
  boba: "Boba",
  kava: "Kava",
  kcc: "KCC",
  xlayer: "X Layer",
  astar: "Astar",
  ronin: "Ronin",
  sei: "Sei",
  zeta: "ZetaChain",
  mobm: "Moonbeam",
  movr: "Moonriver",
  pze: "Polygon zkEVM",
  pls: "PulseChain",
  frax: "Fraxtal",
  lisk: "Lisk",
  zircuit: "Zircuit",
  zkfair: "ZKFair",
  zklink: "ZKLink Nova",
  zkl: "ZKLink Nova",
  bitlayer: "Bitlayer",
  bera: "Berachain",
  berachain: "Berachain",
  unichain: "Unichain",
  ink: "Ink",
  soneium: "Soneium",
  world: "World Chain",
  ape: "ApeChain",
  corn: "Corn",
  hyperevm: "HyperEVM",
  heco: "HECO",
  kroma: "Kroma",
  viction: "Viction",
  xdc: "XDC",
  telos: "Telos",
  canto: "Canto",
  dfk: "DFK Chain",
  swelle: "Swellchain",
  bob: "Bob",
  cyber: "Cyber",
  redstone: "Redstone",
  ancient8: "Ancient8",
  orderly: "Orderly",
  mint: "Mint",
  dos: "DOS Chain",
  immutablz: "Immutable zkEVM",
  rss3: "RSS3",
  shib: "Shibarium",
};

/** Prettifies an unknown DeBank chain id: `aero` → `AERO`, `zk-evm` → `ZK EVM`. */
function prettifyChainId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join(" ");
}

/** Whether this DeBank chain id has a hand-written label (i.e. no lookup needed). */
export function hasKnownChainLabel(id: string): boolean {
  return Boolean(DEBANK_CHAIN_LABELS[canonicalChainId(id)]);
}

/** The label for any DeBank chain id, known or not (`ethereum` → `Ethereum`). */
export function debankChainLabel(id: string): string {
  const key = canonicalChainId(id);
  if (!key) return "Unknown chain";
  return DEBANK_CHAIN_LABELS[key] ?? prettifyChainId(key);
}

/** App chain ids that DeBank spells differently. */
export const DEBANK_CHAIN_ALIASES: Record<string, string> = {
  ethereum: "eth",
  binance: "bsc",
  "bnb-chain": "bsc",
  arbitrum: "arb",
  polygon: "matic",
  optimism: "op",
  avalanche: "avax",
  zksync: "era",
  scroll: "scrl",
  mantle: "mnt",
  fantom: "ftm",
  gnosis: "xdai",
  cronos: "cro",
  "polygon-zkevm": "pze",
  "arbitrum-nova": "nova",
  kaia: "klay",
  "zk-sync": "era",
  // DeBank is EVM-only, but aliases keep a stray non-EVM id recognisable as such.
  sol: "solana",
  btc: "bitcoin",
  xbt: "bitcoin",
  trx: "tron",
};

/**
 * The canonical DeBank id for a chain value, whichever vocabulary it came from:
 * `ethereum`, `Ethereum` and `eth` all become `eth`. Unknown ids are lowercased
 * and returned as-is, so chains this app has never heard of still compare
 * correctly.
 */
export function canonicalChainId(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return "";
  return DEBANK_CHAIN_ALIASES[key] ?? key;
}

/** Whether a scanned chain belongs to a requested chain filter. */
export function chainMatchesFilter(chain: string, filter: string): boolean {
  if (!filter || filter === "auto") return true;
  return canonicalChainId(chain) === canonicalChainId(filter);
}
