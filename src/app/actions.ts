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
import { refreshPricesWithAlerts } from "@/lib/price-refresh";
import {
  clearAssetOrder,
  clearGroupOrder,
  nextPositionForNewAsset,
  persistAssetOrder,
  saveGroupOrder,
} from "@/lib/asset-order-db";
import { isHoldingGroupKey } from "@/lib/holdings-groups";
import { eq } from "drizzle-orm";
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
    if (!name && !symbol) throw new Error("Name or symbol is required");
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

    // Place new holdings at the end of an existing custom order.
    const sortOrder = await nextPositionForNewAsset();

    const [row] = await db
      .insert(assets)
      .values({ type, name: name || symbol, symbol, cryptoCategory, currentPrice, notes, sortOrder })
      .returning({ id: assets.id });
    newId = row.id;

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
    await db
      .update(assets)
      .set({ name: name || symbol, symbol, cryptoCategory, notes: str(fd, "notes") })
      .where(eq(assets.id, id));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update" };
  }
  refresh();
  return { ok: true, ts: Date.now() };
}

function parseOrder(raw: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not read the new order. Reload the page and try again.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("The new order is empty.");
  if (parsed.length > 10_000) throw new Error("Too many holdings to reorder at once.");
  const ids = parsed.map((value) => Number(value));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("The new order contains an invalid holding id.");
  }
  if (new Set(ids).size !== ids.length) throw new Error("The new order contains duplicates.");
  return ids;
}

function parseGroups(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not read the category order. Reload the page and try again.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("The category order is empty.");
  if (parsed.length > 32) throw new Error("Too many categories.");
  const keys = parsed.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (keys.some((key) => !isHoldingGroupKey(key))) {
    throw new Error("The category order contains an unknown category.");
  }
  return keys;
}

/**
 * Persists the drag-and-drop order from the dashboard "Arrange" mode — both the
 * holding positions and the category/section order.
 */
export async function saveAssetOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await ensureSchema();
    const submitted = parseOrder(str(fd, "order"));
    const rawGroups = str(fd, "categories");
    // Re-validated against the database, so a stale tab cannot reorder a holding
    // that was deleted or omit one that was added elsewhere.
    const ordered = await persistAssetOrder(submitted);
    if (ordered.length === 0) throw new Error("There are no holdings to order.");
    if (rawGroups) await saveGroupOrder(parseGroups(rawGroups));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the order" };
  }
  refresh();
  return { ok: true, message: "Order saved.", ts: Date.now() };
}

/** Clears every explicit position, returning to the default type/name order. */
export async function resetAssetOrder(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    await clearAssetOrder();
    await clearGroupOrder();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reset the order" };
  }
  refresh();
  return { ok: true, message: "Order reset to the default.", ts: Date.now() };
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

export async function autoRefreshCryptoPrices(_prev: ActionState): Promise<ActionState> {
  try {
    const summary = await runDailyPriceSnapshot({ onlyStaleCrypto: false });
    if (!summary.totalCrypto) throw new Error("Add a crypto holding with a symbol first.");
    if (!summary.refreshedCrypto) {
      throw new Error("No exchange returned a price. Check your asset symbols and try again.");
    }
    refresh();
    const missing = summary.totalCrypto - summary.refreshedCrypto;
    return {
      ok: true,
      message: `Refreshed ${summary.refreshedCrypto} crypto price${summary.refreshedCrypto === 1 ? "" : "s"} · daily snapshot saved${missing ? ` · ${missing} unavailable` : ""}`,
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
    const summary = await refreshPricesWithAlerts({ onlyStaleCrypto: true });
    if (summary.refreshedCrypto > 0) refresh();
    return { refreshed: summary.refreshedCrypto, date: summary.date };
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
