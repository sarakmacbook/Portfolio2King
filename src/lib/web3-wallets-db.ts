import { eq } from "drizzle-orm";
import { db, isDatabaseConfigured } from "@/db";
import { appSettings } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import { parseWeb3WalletId, type Web3WalletId } from "@/lib/web3-wallets";

export const CRYPTO_WALLET_LOGOS_SETTING = "crypto.walletLogos";

export function parseWalletLogosMap(raw: unknown): Record<number, Web3WalletId> {
  if (typeof raw === "string") {
    try {
      return parseWalletLogosMap(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<number, Web3WalletId> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    const wallet = parseWeb3WalletId(value);
    if (Number.isInteger(id) && id > 0 && wallet) {
      out[id] = wallet;
    }
  }
  return out;
}

export async function loadAssetWalletLogos(): Promise<Record<number, Web3WalletId>> {
  if (!isDatabaseConfigured()) return {};
  try {
    await ensureSchema();
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, CRYPTO_WALLET_LOGOS_SETTING))
      .limit(1);
    return parseWalletLogosMap(row?.value ?? null);
  } catch {
    return {};
  }
}

export async function saveAssetWalletLogo(
  assetId: number,
  walletId: Web3WalletId | "",
): Promise<void> {
  if (!isDatabaseConfigured() || !Number.isInteger(assetId) || assetId <= 0) return;
  await ensureSchema();
  const current = await loadAssetWalletLogos();
  if (walletId) {
    current[assetId] = walletId;
  } else {
    delete current[assetId];
  }
  const value = JSON.stringify(current);
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key: CRYPTO_WALLET_LOGOS_SETTING, value, updatedAt })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt },
    });
}
