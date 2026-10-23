"use server";

import { revalidatePath } from "next/cache";
import {
  getExchangeCredentials,
  isExchangeId,
  looksLikeApiKey,
  looksLikeApiSecret,
  normaliseCredential,
  saveExchangeCredentials,
} from "@/lib/exchange-credentials";
import { EXCHANGE_IDS, EXCHANGE_LABELS, verifyExchangeCredentials, type ExchangeId } from "@/lib/exchanges";
import {
  describeSyncResult,
  disconnectExchange,
  syncExchange,
  type ExchangeSyncResult,
} from "@/lib/exchange-sync";

export type ExchangeActionState = {
  error?: string;
  message?: string;
  warning?: string;
  ok?: boolean;
  ts?: number;
  result?: ExchangeSyncResult;
};

function field(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function exchangeFrom(fd: FormData): ExchangeId {
  const value = field(fd, "exchange");
  if (!isExchangeId(value)) throw new Error("Unknown exchange");
  return value;
}

/** Rethrows exchange/API messages as-is; those are written for humans already. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function saveExchangeKeyAction(
  _prev: ExchangeActionState,
  fd: FormData,
): Promise<ExchangeActionState> {
  let result: ExchangeSyncResult;
  let exchange: ExchangeId;
  try {
    exchange = exchangeFrom(fd);
    const label = EXCHANGE_LABELS[exchange];
    const apiKey = normaliseCredential(fd.get("apiKey"), "API key");
    const secret = normaliseCredential(fd.get("apiSecret"), "API secret");
    const passphrase = normaliseCredential(fd.get("passphrase"), "Passphrase");
    const requestedAccountType = normaliseCredential(fd.get("accountType"), "Account type").toUpperCase();

    if (!apiKey) throw new Error(`${label} API key is required.`);
    if (!secret) throw new Error(`${label} API secret is required.`);
    if (!looksLikeApiKey(apiKey)) {
      throw new Error("That does not look like an API key — check for spaces or a partial paste.");
    }
    if (!looksLikeApiSecret(secret)) {
      throw new Error("That does not look like an API secret — check for spaces or a partial paste.");
    }
    if (exchange === "okx" && !passphrase) {
      throw new Error("OKX also needs the passphrase you set when creating the key.");
    }
    const accountType = exchange === "bybit" ? requestedAccountType || "UNIFIED" : "";
    if (exchange === "bybit" && !["UNIFIED", "SPOT", "CONTRACT"].includes(accountType)) {
      throw new Error("Bybit account type must be UNIFIED, SPOT or CONTRACT.");
    }

    const credentials = {
      exchange,
      apiKey,
      secret,
      passphrase: exchange === "okx" ? passphrase : "",
      accountType,
      savedAt: new Date().toISOString(),
    };

    // Verify before storing, so a typo never becomes a saved-but-broken key.
    // Its answer is the first import, so connecting costs one API call.
    const balances = await verifyExchangeCredentials(credentials);

    await saveExchangeCredentials(credentials);
    result = await syncExchange(exchange, Date.now(), balances);
    if (balances.length === 0 && result.warnings.length === 0) {
      result.warnings.push(`${label} returned no balances for this key.`);
    }
  } catch (error) {
    return { error: messageOf(error, "Could not connect the exchange key") };
  }

  revalidatePath("/exchanges");
  revalidatePath("/", "layout");
  return {
    ok: true,
    ts: Date.now(),
    message: `${EXCHANGE_LABELS[exchange]} connected — ${describeSyncResult(result, { label: false })}`,
    warning: result.warnings[0],
    result,
  };
}

/** Re-reads one exchange and books the difference into the portfolio. */
export async function syncExchangeAction(
  _prev: ExchangeActionState,
  fd: FormData,
): Promise<ExchangeActionState> {
  let result: ExchangeSyncResult;
  let exchange: ExchangeId;
  try {
    exchange = exchangeFrom(fd);
    if (!(await getExchangeCredentials(exchange))) {
      throw new Error(`No ${EXCHANGE_LABELS[exchange]} key saved. Connect one first.`);
    }
    result = await syncExchange(exchange);
  } catch (error) {
    return { error: messageOf(error, "Could not sync the exchange") };
  }

  revalidatePath("/exchanges");
  revalidatePath("/", "layout");
  return {
    ok: true,
    ts: Date.now(),
    message: describeSyncResult(result),
    warning: result.warnings[0],
    result,
  };
}

/** Syncs every connected exchange; one failure does not stop the others. */
export async function syncAllExchangesAction(
  _prev: ExchangeActionState,
  _fd: FormData,
): Promise<ExchangeActionState> {
  const results: ExchangeSyncResult[] = [];
  const errors: string[] = [];
  let connected = 0;

  for (const exchange of EXCHANGE_IDS) {
    try {
      if (!(await getExchangeCredentials(exchange))) continue;
      connected += 1;
      results.push(await syncExchange(exchange));
    } catch (error) {
      errors.push(`${EXCHANGE_LABELS[exchange]}: ${messageOf(error, "sync failed")}`);
    }
  }

  revalidatePath("/exchanges");
  revalidatePath("/", "layout");

  if (connected === 0) {
    return { error: "No exchanges connected yet. Add a read-only API key first." };
  }
  if (results.length === 0 && errors.length > 0) {
    return { error: errors.join(" ") };
  }

  const warning = [...results.flatMap((r) => r.warnings), ...errors][0];
  return {
    ok: true,
    ts: Date.now(),
    message: results.map((result) => describeSyncResult(result)).join(" "),
    warning,
  };
}

/** Removes the stored key. Imported holdings stay in the portfolio. */
export async function disconnectExchangeAction(
  _prev: ExchangeActionState,
  fd: FormData,
): Promise<ExchangeActionState> {
  let exchange: ExchangeId;
  try {
    exchange = exchangeFrom(fd);
    await disconnectExchange(exchange);
  } catch (error) {
    return { error: messageOf(error, "Could not disconnect the exchange") };
  }
  revalidatePath("/exchanges");
  return {
    ok: true,
    ts: Date.now(),
    message: `${EXCHANGE_LABELS[exchange]} disconnected. The holdings it imported stay in your portfolio.`,
  };
}
