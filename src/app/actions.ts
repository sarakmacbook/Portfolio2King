"use server";

import { db } from "@/db";
import {
  ASSET_TYPES,
  CRYPTO_CATEGORIES,
  TX_KINDS,
  assets,
  transactions,
  type AssetType,
  type CryptoCategory,
  type TxKind,
} from "@/db/schema";
import { kindsFor } from "@/lib/format";
import {
  ensureSchema,
  getAssetTransactions,
  recomputeAsset,
  recordAssetPriceSnapshot,
  recordSnapshot,
  replay,
  runDailyPriceSnapshot,
  today,
} from "@/lib/portfolio";
import { parsePriceSource } from "@/lib/market-prices";
import { getWeb3Wallet, parseWeb3WalletId } from "@/lib/web3-wallets";
import { saveAssetWalletLogo } from "@/lib/web3-wallets-db";
import { refreshPricesWithAlerts } from "@/lib/price-refresh";
import { clearDashboardLayout, persistDashboardLayout } from "@/lib/dashboard-layout-save";
import {
  loadHoldingFolderAssignments,
  loadHoldingsFolders,
  saveHoldingFolderAssignments,
  saveHoldingsFolders,
  setHoldingFolder,
} from "@/lib/dashboard-order-db";
import { folderForImport } from "@/lib/holdings-folders";
import { shortWalletAddress } from "@/lib/wallet-chains";
import { isDust, normaliseDustThreshold } from "@/lib/wallet-dust";
import { isSpamToken } from "@/lib/wallet-spam";
import { contractStatusOf } from "@/lib/token-trust";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ActionState = { error?: string; message?: string; ok?: boolean; ts?: number };

function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? "").trim();
}

function num(fd: FormData, key: string, { required = false, min = 0 } = {}) {
  const raw = str(fd, key).replace(/,/g, "");
  if (!raw) {
    if (required) throw new Error(`${key} is required`);
    return 0;
  }
  const n = Number(raw);
  if (!isFinite(n)) throw new Error(`${key} must be a number`);
  if (n < min) throw new Error(`${key} must be ≥ ${min}`);
  return n;
}

function validDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today();
}

function refresh() {
  revalidatePath("/", "layout");
}

/** Validates that adding a tx to an asset keeps the replay consistent. */
async function validateWithNewTx(
  assetId: number,
  type: AssetType,
  tx: { kind: TxKind; quantity: number; price: number; fee: number; date: string },
  excludeTxId?: number,
) {
  const existing = (await getAssetTransactions(assetId)).filter((t) => t.id !== excludeTxId);
  const merged = [...existing, { ...tx, id: Number.MAX_SAFE_INTEGER }].sort((a, b) =>
    a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1,
  );
  return replay(type, merged).error;
}

async function settleCash(
  cashAccountId: number,
  direction: "withdraw" | "deposit",
  amount: number,
  date: string,
  note: string,
) {
  if (!cashAccountId || amount <= 0) return;
  const [cash] = await db.select().from(assets).where(eq(assets.id, cashAccountId));
  if (!cash || cash.type !== "cash") throw new Error("Selected cash account not found");
  const tx = { kind: direction, quantity: amount, price: 1, fee: 0, date } as const;
  const err = await validateWithNewTx(cash.id, "cash", tx);
  if (err) throw new Error(`Insufficient cash in "${cash.name}": ${err}`);
  await db.insert(transactions).values({ assetId: cash.id, ...tx, note });
  await recomputeAsset(cash.id);
}

export async function createAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let newId: number;
  try {
    await ensureSchema();
    const type = str(fd, "type") as AssetType;
    if (!ASSET_TYPES.includes(type)) throw new Error("Invalid asset type");
    const name = str(fd, "name");
    const symbol = str(fd, "symbol").toUpperCase();
    const requestedCategory = str(fd, "cryptoCategory") as CryptoCategory;
    const cryptoCategory: CryptoCategory =
      type === "crypto" && CRYPTO_CATEGORIES.includes(requestedCategory) ? requestedCategory : "volatile";
    // Only crypto is priced from an exchange; anything else stores no source.
    const priceSource = type === "crypto" ? parsePriceSource(str(fd, "priceSource")) : "";
    const walletLogo = type === "crypto" ? parseWeb3WalletId(str(fd, "walletLogo")) : "";
    const defaultWalletName = walletLogo ? (getWeb3Wallet(walletLogo)?.name ?? "") : "";
    const resolvedName = name || defaultWalletName || symbol;
    if (!resolvedName && !symbol) throw new Error("Name or symbol is required");
    const quantity = num(fd, "quantity");
    const isCash = type === "cash";
    const avgCost = isCash ? 1 : num(fd, "avgCost");
    const currentPriceRaw = isCash ? 1 : num(fd, "currentPrice");
    const currentPrice = currentPriceRaw || avgCost;
    const fee = isCash ? 0 : num(fd, "fee");
    const date = validDate(str(fd, "date"));
    const notes = str(fd, "notes");
    const cashAccountId = Number(str(fd, "cashAccountId")) || 0;

    if (!isCash && quantity > 0 && avgCost <= 0 && currentPrice <= 0) {
      throw new Error("Enter a buy price or current price");
    }

    const [row] = await db
      .insert(assets)
      .values({ type, name: resolvedName, symbol, cryptoCategory, priceSource, currentPrice, notes })
      .returning({ id: assets.id });
    newId = row.id;
    if (walletLogo) {
      await saveAssetWalletLogo(newId, walletLogo);
    }

    if (quantity > 0) {
      await db.insert(transactions).values({
        assetId: newId,
        kind: isCash ? "deposit" : "buy",
        quantity,
        price: avgCost || currentPrice,
        fee,
        date,
        note: "Opening balance",
      });
      await recomputeAsset(newId);
      if (!isCash && cashAccountId) {
        try {
          await settleCash(cashAccountId, "withdraw", quantity * (avgCost || currentPrice) + fee, date, `Buy ${symbol || name}`);
        } catch (e) {
          await db.delete(assets).where(eq(assets.id, newId));
          throw e;
        }
      }
      if (!isCash && (avgCost || currentPrice) > 0) {
        await recordAssetPriceSnapshot(newId, date, avgCost || currentPrice, false);
      }
    }
    await recordSnapshot();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create asset" };
  }
  refresh();
  redirect(`/assets/${newId}`);
}

export async function updateAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = Number(str(fd, "id"));
    const [asset] = await db.select().from(assets).where(eq(assets.id, id));
    if (!asset) throw new Error("Asset not found");
    const name = str(fd, "name");
    const symbol = str(fd, "symbol").toUpperCase();
    if (!name && !symbol) throw new Error("Name or symbol is required");
    const requestedCategory = str(fd, "cryptoCategory") as CryptoCategory;
    const cryptoCategory =
      asset.type === "crypto" && CRYPTO_CATEGORIES.includes(requestedCategory)
        ? requestedCategory
        : asset.cryptoCategory;
    // Absent field = leave the exchange as it is (other callers do not send it).
    const priceSource =
      asset.type === "crypto" && fd.has("priceSource")
        ? parsePriceSource(str(fd, "priceSource"))
        : asset.priceSource;
    if (asset.type === "crypto" && fd.has("walletLogo")) {
      await saveAssetWalletLogo(id, parseWeb3WalletId(str(fd, "walletLogo")));
    }
    await db
      .update(assets)
      .set({ name: name || symbol, symbol, cryptoCategory, priceSource, notes: str(fd, "notes") })
      .where(eq(assets.id, id));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update" };
  }
  refresh();
  return { ok: true, ts: Date.now() };
}

export async function updatePrice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = Number(str(fd, "id"));
    const price = num(fd, "price", { required: true });
    const [asset] = await db.select().from(assets).where(eq(assets.id, id));
    if (!asset) throw new Error("Asset not found");
    if (asset.type === "cash") throw new Error("Cash price is fixed at 1.00");
    await db.update(assets).set({ currentPrice: price, priceUpdatedAt: new Date() }).where(eq(assets.id, id));
    await recordSnapshot();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update price" };
  }
  refresh();
  return { ok: true, ts: Date.now() };
}

export async function bulkUpdatePrices(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    let count = 0;
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith("price_")) continue;
      const id = Number(key.slice(6));
      const raw = String(value).replace(/,/g, "").trim();
      if (!raw) continue;
      const price = Number(raw);
      if (!isFinite(price) || price < 0) throw new Error(`Invalid price "${raw}"`);
      const [asset] = await db.select().from(assets).where(eq(assets.id, id));
      if (!asset || asset.type === "cash" || asset.currentPrice === price) continue;
      await db.update(assets).set({ currentPrice: price, priceUpdatedAt: new Date() }).where(eq(assets.id, id));
      count++;
    }
    if (count) await recordSnapshot();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update prices" };
  }
  refresh();
  return { ok: true, ts: Date.now() };
}

export async function autoRefreshPrices(_prev: ActionState): Promise<ActionState> {
  try {
    const summary = await runDailyPriceSnapshot({ onlyStale: false });
    const total = summary.totalCrypto + summary.totalStocks;
    const refreshed = summary.refreshedCrypto + summary.refreshedStocks;
    if (!total) throw new Error("Add a stock or crypto holding with a symbol first.");
    if (!refreshed) {
      throw new Error("No price source returned a quote. Check your asset symbols and try again.");
    }
    refresh();
    const missing = total - refreshed;
    const parts = [
      summary.refreshedCrypto ? `${summary.refreshedCrypto} crypto` : "",
      summary.refreshedStocks ? `${summary.refreshedStocks} stock${summary.refreshedStocks === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return {
      ok: true,
      message: `Refreshed ${parts.join(" + ")} · daily snapshot saved${missing ? ` · ${missing} unavailable` : ""}`,
      ts: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to refresh live prices", ts: Date.now() };
  }
}

/**
 * Silent once-per-day live refresh triggered automatically when viewing the app
 * on a new calendar day with stale previous-day prices.
 */
export async function ensureDailyLiveSnapshot(): Promise<{ refreshed: number; date: string }> {
  try {
    // Goes through the alerting path so the first refresh of a new day can also
    // send threshold notifications instead of silently updating prices.
    const summary = await refreshPricesWithAlerts({ onlyStale: true });
    if (summary.refreshedCrypto + summary.refreshedStocks > 0) refresh();
    return { refreshed: summary.refreshedCrypto + summary.refreshedStocks, date: summary.date };
  } catch {
    return { refreshed: 0, date: today() };
  }
}

export async function addTransaction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const assetId = Number(str(fd, "assetId"));
    const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
    if (!asset) throw new Error("Asset not found");
    const kind = str(fd, "kind") as TxKind;
    if (!TX_KINDS.includes(kind) || !kindsFor(asset.type).includes(kind)) throw new Error("Invalid transaction type");
    const quantity = num(fd, kind === "dividend" ? "amount" : "quantity", { required: true });
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");
    const isCashLike = asset.type === "cash" || kind === "dividend";
    const price = isCashLike ? 1 : num(fd, "price", { required: true });
    const fee = num(fd, "fee");
    const date = validDate(str(fd, "date"));
    const note = str(fd, "note");
    const cashAccountId = Number(str(fd, "cashAccountId")) || 0;

    const err = await validateWithNewTx(assetId, asset.type, { kind, quantity, price, fee, date });
    if (err) throw new Error(err);

    const label = asset.symbol || asset.name;
    if (cashAccountId && asset.type !== "cash" && cashAccountId !== asset.id) {
      if (kind === "buy") await settleCash(cashAccountId, "withdraw", quantity * price + fee, date, `Buy ${label}`);
      if (kind === "sell") await settleCash(cashAccountId, "deposit", quantity * price - fee, date, `Sell ${label}`);
      if (kind === "dividend") await settleCash(cashAccountId, "deposit", quantity - fee, date, `Income from ${label}`);
    }

    await db.insert(transactions).values({ assetId, kind, quantity, price, fee, date, note });
    await recomputeAsset(assetId);
    if (kind === "buy" && asset.currentPrice === 0) {
      await db.update(assets).set({ currentPrice: price }).where(eq(assets.id, assetId));
    }
    if (!isCashLike && price > 0) {
      await recordAssetPriceSnapshot(assetId, date, price, false);
    }
    await recordSnapshot();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add transaction" };
  }
  refresh();
  return { ok: true, ts: Date.now() };
}

export async function deleteTransaction(fd: FormData) {
  const id = Number(fd.get("id"));
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!tx) return;
  const [asset] = await db.select().from(assets).where(eq(assets.id, tx.assetId));
  const remaining = (await getAssetTransactions(tx.assetId)).filter((t) => t.id !== id);
  if (asset && replay(asset.type, remaining).error) {
    // Deleting would make later sells invalid; skip silently.
    return;
  }
  await db.delete(transactions).where(eq(transactions.id, id));
  await recomputeAsset(tx.assetId);
  await recordSnapshot();
  refresh();
}

export async function deleteAsset(fd: FormData) {
  const id = Number(fd.get("id"));
  await db.delete(assets).where(eq(assets.id, id));
  await recordSnapshot();
  refresh();
  redirect("/");
}

/**
 * Deletes every holding that looks like airdropped spam.
 *
 * The table already hides spam, but a token imported before the rules existed
 * (or pasted in by hand) is still in the database — hidden, or worse, counted
 * nowhere while sitting in the folder list. This is the one-click clean-up: it
 * uses exactly the same rule as the filter, so what the notice says is hidden is
 * what gets deleted, and it reports how many it removed.
 */
export async function removeSpamHoldings(): Promise<{ removed: number }> {
  await ensureSchema();
  const list = await db.select().from(assets);
  const junk = list.filter((asset) => isSpamToken(asset));
  if (junk.length === 0) return { removed: 0 };
  await db.delete(assets).where(inArray(assets.id, junk.map((asset) => asset.id)));
  await recordSnapshot();
  refresh();
  return { removed: junk.length };
}

export async function saveDashboardLayout(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await ensureSchema();
    await persistDashboardLayout({
      order: str(fd, "order"),
      statsOrder: str(fd, "statsOrder") || undefined,
      statsLabels: str(fd, "statsLabels") || undefined,
      holdingCategories: str(fd, "holdingCategories") || undefined,
      // The holdings themselves, their folders and the filing are all optional:
      // a form without them leaves what is stored untouched.
      holdingOrder: fd.has("holdingOrder") ? str(fd, "holdingOrder") : undefined,
      holdingFolders: fd.has("holdingFolders") ? str(fd, "holdingFolders") : undefined,
      holdingFolderAssignments: fd.has("holdingFolders")
        ? str(fd, "holdingFolderAssignments") || "{}"
        : undefined,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the dashboard layout" };
  }
  refresh();
  return { ok: true, message: "Dashboard layout saved.", ts: Date.now() };
}

/** Restores the default dashboard card order, stat cards, tabs and folders. */
export async function resetDashboardLayout(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    await clearDashboardLayout();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reset the dashboard layout" };
  }
  refresh();
  return { ok: true, message: "Dashboard layout reset to the default.", ts: Date.now() };
}

/**
 * Files one holding into a folder — or, with `folderId: null`, back to no
 * folder at all — and stores it straight away.
 *
 * This is the drag-and-drop path used outside "Arrange layout" mode, where a
 * drop on a folder should take effect immediately instead of waiting for a
 * **Save layout** click. Arrange mode keeps its own deferred behaviour: there the
 * table edits the pending filing in memory and one save writes everything.
 */
export async function saveHoldingFolderAssignment(input: {
  assetId: number;
  folderId: string | null;
}): Promise<{ ok: boolean; error?: string; assignments?: Record<number, string> }> {
  try {
    await ensureSchema();
    const assignments = await setHoldingFolder(Number(input?.assetId), input?.folderId ?? null);
    refresh();
    return { ok: true, assignments };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not move that holding." };
  }
}

/**
 * Imports a scanned wallet as holdings, filed into a folder named after the
 * wallet.
 *
 * Importing a wallet used to leave its tokens loose in the table. They now land
 * in one folder — the folder keeps the wallet together and can be collapsed,
 * renamed or dragged like any other. `folderName` is what the user typed; left
 * blank it falls back to the short address (`0x1234…abcd`). Pass
 * `folderName: null` to import without a folder at all.
 */
export async function importWalletBalances(input: {
  address: string;
  walletLogo?: string;
  priceSource?: string;
  /** Folder to file the holdings into; omit / empty for the short address, `null` for no folder. */
  folderName?: string | null;
  /**
   * Skip balances worth less than this many USD. `0` / omitted imports
   * everything. Applied here as well as in the dialog so a stale page cannot
   * slip dust into the portfolio.
   */
  minValueUsd?: number;
  /**
   * Skip tokens that look like airdropped spam (a web address, promo wording, a
   * fake ticker). Applied here as well as in the dialog, so a stale page cannot
   * import junk.
   */
  skipSpam?: boolean;
  /**
   * Skip tokens whose contract is not the official one for their symbol — the
   * fake-`USDT` problem. Checked here as well as in the dialog, from the same
   * table, so a stale page cannot import a look-alike.
   */
  skipImpostor?: boolean;
  /**
   * Skip tokens with less than this much organic 24h volume. `0` / omitted
   * imports everything; an unknown volume is never a reason to skip.
   */
  minOrganicVolumeUsd?: number;
  /**
   * Skip tokens holding less than this much liquidity in their pools. Depth is
   * the hardest thing for a fake token to manufacture, so the same floor the
   * dialog uses is re-applied here. Unknown depth is never a reason to skip.
   */
  minLiquidityUsd?: number;
  balances: Array<{
    symbol: string;
    name: string;
    chainLabel: string;
    /** Chain id the balance sits on, for the official-contract lookup. */
    chain?: string;
    quantity: number;
    price: number;
    category: CryptoCategory;
    contract: string | null;
    /** Spam flag from the indexer, when one was passed along. */
    spam?: boolean;
    /** Organic 24h volume measured by the scan, when it had an answer. */
    organicVolumeUsd?: number;
    /** Pooled liquidity measured by the scan, when it had an answer. */
    liquidityUsd?: number;
  }>;
}): Promise<{
  ok: boolean;
  importedCount: number;
  error?: string;
  /** The folder the holdings were filed into, when one was used. */
  folder?: { id: string; name: string };
  /** Set when a folder was asked for but could not be created. */
  folderNote?: string;
  /** How many balances were skipped for being under `minValueUsd`. */
  skippedDust?: number;
  /** How many balances were skipped for looking like spam. */
  skippedSpam?: number;
  /** How many had a non-official contract for their symbol. */
  skippedImpostor?: number;
  /** How many were skipped for having no organic trading volume. */
  skippedThin?: number;
  /** How many were skipped for having too little pooled liquidity. */
  skippedShallow?: number;
}> {
  try {
    await ensureSchema();
    const address = String(input.address ?? "").trim();
    if (!address) throw new Error("Wallet address is required.");
    const items = Array.isArray(input.balances) ? input.balances : [];
    if (items.length === 0) {
      throw new Error("No wallet balances selected to import.");
    }

    const walletLogo = parseWeb3WalletId(input.walletLogo ?? "");
    const priceSource = parsePriceSource(input.priceSource ?? "");
    const d = today();
    const shortAddr = shortWalletAddress(address) || address;
    const importedIds: number[] = [];
    // Omitted means "no cut-off"; a number is clamped like the dialog's box.
    const minValueUsd = Number(input.minValueUsd) > 0 ? normaliseDustThreshold(input.minValueUsd) : 0;
    let skippedDust = 0;
    let skippedSpam = 0;
    let skippedImpostor = 0;
    let skippedThin = 0;
    let skippedShallow = 0;
    const minVolume =
      Number(input.minOrganicVolumeUsd) > 0 ? Number(input.minOrganicVolumeUsd) : 0;
    const minLiquidity = Number(input.minLiquidityUsd) > 0 ? Number(input.minLiquidityUsd) : 0;

    for (const item of items.slice(0, 50)) {
      const symbol = String(item.symbol ?? "").trim().toUpperCase();
      const name = String(item.name ?? symbol).trim();
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      if (!symbol || !Number.isFinite(quantity) || quantity <= 0) continue;
      // Contract first: a look-alike `USDT` is the one token that can quietly
      // become the biggest holding in the portfolio.
      const chain = String(item.chain ?? item.chainLabel ?? "");
      if (
        input.skipImpostor !== false &&
        contractStatusOf({ symbol, contract: item.contract, chain }) === "different"
      ) {
        skippedImpostor += 1;
        continue;
      }
      // Tokens nobody trades: the price is whatever the minter typed in. Only
      // skipped when the scan actually measured a volume.
      const organic = Number(item.organicVolumeUsd);
      if (minVolume > 0 && Number.isFinite(organic) && organic < minVolume) {
        skippedThin += 1;
        continue;
      }
      // Depth: a token with a few hundred dollars of pooled liquidity is not a
      // market — it is a price someone typed in.
      const liquidity = Number(item.liquidityUsd);
      if (minLiquidity > 0 && Number.isFinite(liquidity) && liquidity < minLiquidity) {
        skippedShallow += 1;
        continue;
      }
      // Spam: checked before the value, because a scam token with a made-up
      // price is the one a dollar cut-off cannot catch.
      if (input.skipSpam !== false && isSpamToken({ name, symbol, spam: item.spam === true })) {
        skippedSpam += 1;
        continue;
      }
      // Dust: measured on value, not quantity — a million near-worthless tokens
      // are dust just like a fraction of a cent.
      if (isDust({ valueUsd: quantity * (Number.isFinite(price) ? price : 0) }, minValueUsd)) {
        skippedDust += 1;
        continue;
      }
      // An unpriced token is booked at 0, not at $1: the scan did not know the
      // price, and inventing one would put fake value in the portfolio.
      const safePrice = Number.isFinite(price) && price > 0 ? price : 0;
      const cryptoCategory: CryptoCategory =
        CRYPTO_CATEGORIES.includes(item.category) ? item.category : "volatile";
      const notes = `Wallet: ${address} (${shortAddr}) · Chain: ${item.chainLabel}${
        item.contract ? ` · Contract: ${item.contract}` : ""
      }`;

      const [row] = await db
        .insert(assets)
        .values({
          type: "crypto",
          name: name || symbol,
          symbol,
          cryptoCategory,
          priceSource,
          currentPrice: safePrice,
          notes,
        })
        .returning({ id: assets.id });

      await db.insert(transactions).values({
        assetId: row.id,
        kind: "buy",
        quantity,
        price: safePrice,
        fee: 0,
        date: d,
        note: `Imported from wallet ${shortAddr} (${item.chainLabel})`,
      });
      await recomputeAsset(row.id);
      await recordAssetPriceSnapshot(row.id, d, safePrice, false);
      if (walletLogo) {
        await saveAssetWalletLogo(row.id, walletLogo);
      }
      importedIds.push(row.id);
    }

    const importedCount = importedIds.length;

    if (importedCount === 0) {
      throw new Error("No non-zero balances could be imported from that wallet.");
    }

    // File the new holdings into one folder so the wallet reads as a group
    // instead of a pile of loose rows. `folderName: null` skips this; a blank
    // name means "name the folder after the address".
    let folder: { id: string; name: string } | undefined;
    let folderNote: string | undefined;
    if (input.folderName !== null) {
      const folders = await loadHoldingsFolders();
      const wanted = String(input.folderName ?? "").trim() || shortAddr;
      const result = folderForImport(folders, wanted);
      if (result.folder) {
        if (result.folders.length !== folders.length) {
          await saveHoldingsFolders(result.folders);
        }
        const current = await loadHoldingFolderAssignments(result.folders);
        const next = { ...current };
        for (const id of importedIds) next[id] = result.folder.id;
        await saveHoldingFolderAssignments(next, result.folders);
        folder = { id: result.folder.id, name: result.folder.name };
      } else {
        folderNote = `Imported without a folder: there is no room for another one (${folders.length} max).`;
      }
    }

    await recordSnapshot();
    refresh();
    return {
      ok: true,
      importedCount,
      folder,
      folderNote,
      ...(skippedDust > 0 ? { skippedDust } : {}),
      ...(skippedSpam > 0 ? { skippedSpam } : {}),
      ...(skippedImpostor > 0 ? { skippedImpostor } : {}),
      ...(skippedThin > 0 ? { skippedThin } : {}),
      ...(skippedShallow > 0 ? { skippedShallow } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      importedCount: 0,
      error: e instanceof Error ? e.message : "Could not import wallet balances",
    };
  }
}

