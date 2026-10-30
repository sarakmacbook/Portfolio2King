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
import { MAX_FOLDERS, folderForImport, makeFolder, type HoldingFolder } from "@/lib/holdings-folders";
import { shortWalletAddress } from "@/lib/wallet-chains";
import { isDust, normaliseDustThreshold } from "@/lib/wallet-dust";
import { isSpamToken } from "@/lib/wallet-spam";
import { contractStatusOf } from "@/lib/token-trust";
import { verificationOf } from "@/lib/wallet-trust";
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
  let folderToCreate: HoldingFolder | null = null;
  let foldersBeforeCreate: HoldingFolder[] = [];
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
    let folderId = str(fd, "folderId");
    if (folderId === "__new__") {
      foldersBeforeCreate = await loadHoldingsFolders();
      const folderName = str(fd, "folderName");
      if (!folderName) throw new Error("Enter a name for the new folder.");
      if (foldersBeforeCreate.length >= MAX_FOLDERS) {
        throw new Error(`You can have at most ${MAX_FOLDERS} folders.`);
      }
      folderToCreate = makeFolder({ name: folderName }, foldersBeforeCreate);
      if (!folderToCreate) throw new Error("Could not create that folder.");
      folderId = folderToCreate.id;
    } else if (folderId && !(await loadHoldingsFolders()).some((folder) => folder.id === folderId)) {
      throw new Error("That folder no longer exists. Refresh and try again.");
    }

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
    if (folderToCreate) {
      await saveHoldingsFolders([...foldersBeforeCreate, folderToCreate]);
    }
    if (folderId) await setHoldingFolder(newId, folderId);
    await recordSnapshot();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create asset" };
  }
  refresh();
  redirect(`/assets/${newId}`);
}

/** Removes all groups and their filing assignments while keeping holdings intact. */
export async function clearAllHoldingGroups(): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureSchema();
    await saveHoldingsFolders([]);
    refresh();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not remove the groups." };
  }
}

/** Creates a top-level group directly from the main Holdings section. */
export async function createHoldingGroup(name: string): Promise<{
  ok: boolean;
  folder?: HoldingFolder;
  error?: string;
}> {
  try {
    await ensureSchema();
    if (!name.trim()) throw new Error("Enter a name for the group.");
    const current = await loadHoldingsFolders();
    if (current.length >= MAX_FOLDERS) throw new Error(`You can have at most ${MAX_FOLDERS} groups.`);
    const folder = makeFolder({ name }, current);
    if (!folder) throw new Error("Could not create that group.");
    await saveHoldingsFolders([...current, folder]);
    refresh();
    return { ok: true, folder };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the group." };
  }
}

/** Creates a nested folder owned by one holding, for filing other holdings inside it. */
export async function createAssetSubfolder(parentAssetId: number, name: string): Promise<{
  ok: boolean;
  folder?: HoldingFolder;
  error?: string;
}> {
  try {
    await ensureSchema();
    if (!Number.isInteger(parentAssetId) || parentAssetId <= 0) throw new Error("Choose a valid parent holding.");
    const [parent] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, parentAssetId))
      .limit(1);
    if (!parent) throw new Error("That holding no longer exists.");
    const current = await loadHoldingsFolders();
    if (!name.trim()) throw new Error("Enter a name for the folder.");
    if (current.length >= MAX_FOLDERS) throw new Error(`You can have at most ${MAX_FOLDERS} folders.`);
    const folder = makeFolder({ name, parentAssetId }, current);
    if (!folder) throw new Error("Could not create that folder.");
    await saveHoldingsFolders([...current, folder]);
    refresh();
    revalidatePath(`/assets/${parentAssetId}`);
    return { ok: true, folder };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the folder." };
  }
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
    // Folder selection from the edit form's dropdown. Absent field = leave the
    // asset's filing alone (other callers do not send it). An empty value files
    // the asset back to no folder; an unknown id is rejected by setHoldingFolder.
    if (fd.has("folderId")) {
      let folderId = str(fd, "folderId");
      if (folderId === "__new__") {
        const folderName = str(fd, "folderName");
        if (!folderName) throw new Error("Enter a name for the new folder.");
        const folders = await loadHoldingsFolders();
        if (folders.length >= MAX_FOLDERS) {
          throw new Error(`You can have at most ${MAX_FOLDERS} folders.`);
        }
        const folder = makeFolder({ name: folderName }, folders);
        if (!folder) throw new Error("Could not create that folder.");
        await saveHoldingsFolders([...folders, folder]);
        folderId = folder.id;
      }
      await setHoldingFolder(id, folderId || null);
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
  await ensureSchema();
  const folders = await loadHoldingsFolders();
  // Folders nested under a deleted holding become ordinary portfolio folders;
  // their child assets and their filing are preserved.
  const promoted = folders.map((folder) => {
    if (folder.parentAssetId !== id) return folder;
    const { parentAssetId: _parentAssetId, ...rootFolder } = folder;
    return rootFolder;
  });
  const assignments = await loadHoldingFolderAssignments(folders);
  delete assignments[id];
  if (promoted.some((folder, index) => folder !== folders[index])) {
    await saveHoldingsFolders(promoted);
  }
  await saveHoldingFolderAssignments(assignments, promoted);
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
  const junkIds = new Set(junk.map((asset) => asset.id));
  const folders = await loadHoldingsFolders();
  const promoted = folders.map((folder) => {
    if (!folder.parentAssetId || !junkIds.has(folder.parentAssetId)) return folder;
    const { parentAssetId: _parentAssetId, ...rootFolder } = folder;
    return rootFolder;
  });
  const assignments = await loadHoldingFolderAssignments(folders);
  for (const id of junkIds) delete assignments[id];
  if (promoted.some((folder, index) => folder !== folders[index])) {
    await saveHoldingsFolders(promoted);
  }
  await saveHoldingFolderAssignments(assignments, promoted);
  await db.delete(assets).where(inArray(assets.id, [...junkIds]));
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
 * renamed or dragged like any other.
 *
 * Three ways to say where they go:
 *
 *   - `folderId` — the folder the user picked from the dropdown. Filed into it
 *     exactly, by id, so a re-scan of the same wallet tops up the same folder
 *     even if another folder has a similar name;
 *   - `folderName` — a name to file into, reusing an existing folder when the
 *     name matches (case-insensitively) and creating one otherwise; left blank
 *     it falls back to the short address (`0x1234…abcd`);
 *   - `folderName: null` — import without a folder at all.
 */
export async function importWalletBalances(input: {
  address: string;
  walletLogo?: string;
  priceSource?: string;
  /** Folder to file the holdings into; omit / empty for the short address, `null` for no folder. */
  folderName?: string | null;
  /**
   * An existing folder picked in the dialog. Wins over `folderName`, and is
   * ignored (falling back to the name) if that folder no longer exists.
   */
  folderId?: string | null;
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
  /**
   * Skip tokens the scan judged not real (no verification, no deep market).
   * Recomputed here from the same rules, so a stale page cannot import junk the
   * picker would have hidden. An unverifiable token is kept, never skipped.
   */
  skipUnverified?: boolean;
  /** The indexer's verification verdict, when it sent one. */
  verified?: boolean;
  /**
   * Import only tokens CoinMarketCap lists for their contract. Honoured only
   * together with the per-balance `cmcId` the scan added — a page that never got
   * a CMC answer sends no ids, and an empty import is worse than a small one.
   */
  requireCmc?: boolean;
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
    /** Liquidity of the token's deepest single pool, when measured. */
    deepestPoolUsd?: number;
    /** The index's own verification verdict, when it sent one. */
    verified?: boolean;
    /** CoinMarketCap's id for the contract, when the trust pass matched it. */
    cmcId?: number;
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
  /** How many were skipped for not being verifiable as a real token. */
  skippedUnverified?: number;
  /** How many were skipped for not being listed on CoinMarketCap. */
  skippedUnlisted?: number;
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
    let skippedUnverified = 0;
    let skippedUnlisted = 0;
    /**
     * "Only tokens on CoinMarketCap" needs proof that the lookup ran: without it
     * every row would look unlisted, and the import would come back empty.
     */
    const hasCmcAnswer = items.some((item) => Number(item.cmcId) > 0);
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
      /**
       * CoinMarketCap: the strictest rule the picker offers, and it is only
       * applied when the balances actually carry a CMC answer (each row has a
       * `cmcId` or not). A native coin has no contract to look up and is kept.
       */
      if (input.requireCmc === true && hasCmcAnswer && item.contract && item.cmcId === undefined) {
        skippedUnlisted += 1;
        continue;
      }
      // Spam: checked before the value, because a scam token with a made-up
      // price is the one a dollar cut-off cannot catch.
      if (input.skipSpam !== false && isSpamToken({ name, symbol, spam: item.spam === true })) {
        skippedSpam += 1;
        continue;
      }
      /**
       * Verification: the picker hides tokens it positively judged not real, so
       * "Import selected" must not book them either. Recomputed from the same
       * rules — official contract, indexer verdict, or a deep market. An
       * `unknown` verdict (no answer) is never a reason to skip.
       */
      if (input.skipUnverified !== false) {
        const verdict = verificationOf({
          symbol,
          name,
          contract: item.contract,
          chain,
          spam: item.spam === true,
          verified: item.verified === true,
          organicVolumeUsd: Number.isFinite(organic) ? organic : undefined,
          liquidityUsd: Number.isFinite(liquidity) ? liquidity : undefined,
          deepestPoolUsd: Number.isFinite(Number(item.deepestPoolUsd))
            ? Number(item.deepestPoolUsd)
            : undefined,
        });
        if (verdict === "unverified") {
          skippedUnverified += 1;
          continue;
        }
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
      // A picked folder is used by id: the name may since have been reused for a
      // different folder, and filing into the wrong one is worse than a new one.
      const pickedId = String(input.folderId ?? "").trim().toLowerCase();
      const picked = pickedId ? folders.find((item) => item.id === pickedId) : undefined;
      const wanted = String(input.folderName ?? "").trim() || shortAddr;
      const result = picked
        ? { folders, folder: picked }
        : folderForImport(folders, wanted);
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
      ...(skippedUnverified > 0 ? { skippedUnverified } : {}),
      ...(skippedUnlisted > 0 ? { skippedUnlisted } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      importedCount: 0,
      error: e instanceof Error ? e.message : "Could not import wallet balances",
    };
  }
}

