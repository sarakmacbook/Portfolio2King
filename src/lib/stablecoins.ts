/**
 * Stablecoin detection, shared by the wallet scanner and the DeBank client.
 *
 * A stablecoin is stored with `cryptoCategory = "stablecoin"` so the Holdings
 * tabs and the allocation donut can split it from volatile crypto. The list is
 * ticker based — no network lookup — so it is cheap and deterministic.
 */

export const STABLECOIN_SYMBOLS = new Set([
  "USDT",
  "USDC",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDE",
  "PYUSD",
  "USDD",
  "FRAX",
  "USDS",
  "GUSD",
  "LUSD",
  "CRVUSD",
  "BUSD",
  "HUSD",
  "ALUSD",
  "MIM",
  "SUSD",
  "USD1",
  "RLUSD",
  "USDP",
  "USDB",
  "EURT",
]);

/** True for a USD-pegged ticker such as `USDT`, `usdc` or `USDe`. */
export function isStablecoinSymbol(symbol: string | null | undefined): boolean {
  if (typeof symbol !== "string") return false;
  return STABLECOIN_SYMBOLS.has(symbol.trim().toUpperCase());
}

/**
 * True when a crypto category takes part in real-time price updates:
 * volatile only. Stablecoins are pegged to the dollar, so real-time updates
 * keep their stored price instead of chasing an order book.
 */
export function isRealtimeCryptoCategory(category: string | null | undefined): boolean {
  return category !== "stablecoin";
}
