/**
 * Official-contract matching.
 *
 * Anyone can deploy a token called `USDT`. When a wallet is scanned, the fake
 * ones arrive with the same symbol, a plausible price and sometimes a bigger
 * balance than the real thing — the only thing that separates them from the real
 * token is the **contract address**.
 *
 * This module holds the addresses of the well-known tokens on the chains this app
 * can price, and answers one question: does this contract match the official one
 * for its symbol on its chain?
 *
 *   official  — the address is the one the issuer deployed
 *   different — the symbol is a known token on this chain, but the address is not
 *               that token's. This is the impersonation case.
 *   unknown   — no address is recorded here, so nothing can be claimed either way
 *
 * `unknown` is the common answer for the long tail of real tokens and is never a
 * reason to hide anything: a token this table has never heard of is simply
 * unverified, not fake. Only a *different* address can be flagged, because only
 * then does the app know what the real one is.
 *
 * Addresses are the issuers' own (Circle, Tether, Coinbase, the chain teams) and
 * were checked against their documentation; they are safe to keep here because
 * these tokens are never redeployed at a new address on the same chain.
 */

import { canonicalChainId } from "@/lib/wallet-chains";

export type ContractStatus = "official" | "different" | "unknown";

/** Chain id → upper-case symbol → lower-case contract address. */
export const OFFICIAL_CONTRACTS: Record<string, Record<string, string>> = {
  ethereum: {
    USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    DAI: "0x6b175474e89094c44da98b954eedeac495271d0f",
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    CBBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    LINK: "0x514910771af9ca656af840dff83e8264ecf986ca",
    UNI: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    AAVE: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    SHIB: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
    PEPE: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    STETH: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    // LayerZero's OFT is deployed at one identical address on every chain.
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
  },
  base: {
    USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    USDT: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
    DAI: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
    WETH: "0x4200000000000000000000000000000000000006",
    CBBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    LINK: "0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196",
    AERO: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
    "USDC.E": "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
    USDBC: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    "USDC.E": "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
    USDT: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    DAI: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    WETH: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    WBTC: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f",
    ARB: "0x912ce59144191c1204e64559fe8253a0e49e6548",
    LINK: "0xf97f4df75117a78c1a5a0dbb814af92458539fb4",
    CBBTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
  },
  optimism: {
    USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    "USDC.E": "0x7f5c764cbc14f9669b88837ca1490cca17c31607",
    USDT: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
    DAI: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    WETH: "0x4200000000000000000000000000000000000006",
    OP: "0x4200000000000000000000000000000000000042",
    LINK: "0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6",
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
  },
  polygon: {
    USDC: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    "USDC.E": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    USDT: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    DAI: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
    WETH: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
    WBTC: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
    LINK: "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39",
    WPOL: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    WMATIC: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
  },
  bsc: {
    USDT: "0x55d398326f99059ff775485246999027b3197955",
    USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    BUSD: "0xe9e7cea3dedca5984780bafc599bd69add087d56",
    WBNB: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    BTCB: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
    CAKE: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
    ETH: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
    DAI: "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
  },
  avalanche: {
    USDC: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    USDT: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
    "USDT.E": "0xc7198437980c041c805a1edcba50c1ce5db95118",
    WAVAX: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
    "DAI.E": "0xd586e7f844cea2f87f50152665bcbc2c279d8d70",
    "WBTC.E": "0x50b7545627a5162f82a992c33b87adc75187b218",
    ZRO: "0x6985884c4392d348587b19cb9eaaf157f13271cd",
  },
};

/** The chains this table covers, for docs and tests. */
export const TOKEN_TRUST_CHAINS = Object.keys(OFFICIAL_CONTRACTS);

/**
 * The same table keyed by the canonical (DeBank) chain id, because a scan may
 * call Ethereum `eth` — `canonicalChainId` folds every spelling to one id.
 */
const BY_CANONICAL_CHAIN: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(OFFICIAL_CONTRACTS).map(([chain, table]) => [canonicalChainId(chain), table]),
);

/** A 0x-prefixed, 40-hex contract address in lower case, or `null`. */
export function normaliseEvmContract(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}

/** The official address for a symbol on a chain, when one is recorded. */
export function officialContractOf(symbol: string, chain: string): string | null {
  const table = BY_CANONICAL_CHAIN[canonicalChainId(chain)];
  if (!table) return null;
  return table[symbol.trim().toUpperCase()] ?? null;
}

/**
 * Does this token's contract match the official one for its symbol?
 *
 * A missing or malformed contract (native coins, Solana, Bitcoin) is always
 * `unknown` — there is nothing to compare.
 */
export function contractStatusOf(token: {
  symbol?: string | null;
  contract?: string | null;
  chain?: string | null;
}): ContractStatus {
  const contract = normaliseEvmContract(token.contract);
  const symbol = typeof token.symbol === "string" ? token.symbol : "";
  const chain = typeof token.chain === "string" ? token.chain : "";
  if (!contract || !symbol || !chain) return "unknown";

  const official = officialContractOf(symbol, chain);
  if (!official) return "unknown";
  return contract === official ? "official" : "different";
}

/** A short line for the scan list; `null` when there is nothing to say. */
export function contractNoteOf(status: ContractStatus, symbol: string): string | null {
  if (status === "official") return "official contract";
  if (status === "different") return `not the real ${symbol.trim().toUpperCase()} contract`;
  return null;
}
