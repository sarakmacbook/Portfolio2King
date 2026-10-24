"use server";

import { revalidatePath } from "next/cache";
import {
  ScannerKeyError,
  isScannerProvider,
  removeScannerKey,
  saveScannerKey,
  scannerKeySpec,
} from "@/lib/scanner-keys";

/**
 * Server actions behind the "Scanner API keys" panel.
 *
 * Keys are write-only from the browser's point of view: a save sends the key to
 * the server, which stores it encrypted and answers with the masked statuses —
 * never with the key. Both actions revalidate the dashboard, where the panel is
 * rendered.
 */

export type ScannerKeyActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Which row the message belongs to, so the UI can place it. */
  provider?: string;
  ts?: number;
};

function providerFrom(formData: FormData) {
  const value = String(formData.get("provider") ?? "").trim();
  if (!isScannerProvider(value)) throw new ScannerKeyError("Unknown scan source.");
  return value;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function saveScannerKeyAction(
  _previous: ScannerKeyActionState,
  formData: FormData,
): Promise<ScannerKeyActionState> {
  let label = "";
  try {
    const provider = providerFrom(formData);
    label = scannerKeySpec(provider).label;
    await saveScannerKey(provider, formData.get("apiKey"));
  } catch (error) {
    return {
      error: messageOf(error, "Could not save that key"),
      ts: Date.now(),
    };
  }

  revalidatePath("/");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${label} key saved — the next scan will use it.`,
    ts: Date.now(),
  };
}

export async function removeScannerKeyAction(
  _previous: ScannerKeyActionState,
  formData: FormData,
): Promise<ScannerKeyActionState> {
  let label = "";
  try {
    const provider = providerFrom(formData);
    label = scannerKeySpec(provider).label;
    await removeScannerKey(provider);
  } catch (error) {
    return {
      error: messageOf(error, "Could not remove that key"),
      ts: Date.now(),
    };
  }

  revalidatePath("/");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${label} key removed — the environment variable, if any, is used again.`,
    ts: Date.now(),
  };
}
