export const ASSET_TYPES = ["cash", "stock", "crypto", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const TX_KINDS = ["buy", "sell", "deposit", "withdraw", "dividend"] as const;
export type TxKind = (typeof TX_KINDS)[number];
