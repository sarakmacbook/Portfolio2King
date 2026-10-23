"use client";

import { useSyncExternalStore } from "react";

/**
 * Remembered-device cache.
 *
 * The server already knows an unlocked browser by its HttpOnly session cookie.
 * This module is the *client* half: after the first successful Face ID (or PIN)
 * unlock it records that this device has been remembered, so the lock screen can
 * say "welcome back" instead of treating every launch as a first-time visitor,
 * and so the Privacy menu can offer **Forget this device**.
 *
 * Nothing here is a security boundary — the server cookie is. The cache only
 * drives UI copy, the automatic Face ID prompt, and the forget action.
 */

export const DEVICE_MEMORY_KEY = "ledgerly-privacy-device";
/**
 * Marks "the user just locked this on purpose", so the lock screen does not
 * immediately ask for Face ID again and undo the lock. Cleared by the next
 * successful unlock, and scoped to the tab via sessionStorage.
 */
export const LOCK_INTENT_KEY = "ledgerly-privacy-lock-intent";

export type RememberedDevice = {
  /** Credential that was used, when the unlock came from Face ID / Passkey. */
  credentialId: string | null;
  label: string;
  rememberedAt: string;
};

const MAX_LABEL = 80;

/** Pure parser so the server, tests and storage all read the same shape. */
export function parseRememberedDevice(
  raw: string | null | undefined,
): RememberedDevice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedDevice> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const rememberedAt =
      typeof parsed.rememberedAt === "string" ? parsed.rememberedAt : "";
    if (!rememberedAt || Number.isNaN(Date.parse(rememberedAt))) return null;
    return {
      credentialId:
        typeof parsed.credentialId === "string" && parsed.credentialId.trim()
          ? parsed.credentialId.trim()
          : null,
      label:
        typeof parsed.label === "string" && parsed.label.trim()
          ? parsed.label.trim().slice(0, MAX_LABEL)
          : "Face ID / Passkey",
      rememberedAt,
    };
  } catch {
    return null;
  }
}

export function serialiseRememberedDevice(device: RememberedDevice): string {
  return JSON.stringify(device);
}

export function createRememberedDevice(
  info: { credentialId?: string | null; label?: string } = {},
  now: Date = new Date(),
): RememberedDevice {
  return {
    credentialId:
      typeof info.credentialId === "string" && info.credentialId.trim()
        ? info.credentialId.trim()
        : null,
    label:
      typeof info.label === "string" && info.label.trim()
        ? info.label.trim().slice(0, MAX_LABEL)
        : "Face ID / Passkey",
    rememberedAt: now.toISOString(),
  };
}

let cached: RememberedDevice | null | undefined;
const listeners = new Set<() => void>();

function readFromStorage(): RememberedDevice | null {
  try {
    if (typeof window === "undefined") return null;
    return parseRememberedDevice(window.localStorage.getItem(DEVICE_MEMORY_KEY));
  } catch {
    // Private browsing / blocked storage: behave like a brand-new device.
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== DEVICE_MEMORY_KEY) return;
    cached = readFromStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Stable snapshot: the same object is returned until the cache changes. */
export function getRememberedDevice(): RememberedDevice | null {
  if (cached === undefined) cached = readFromStorage();
  return cached;
}

function getServerSnapshot(): RememberedDevice | null {
  return null;
}

export function markLockedOnPurpose(): void {
  try {
    window.sessionStorage.setItem(LOCK_INTENT_KEY, "1");
  } catch {
    // Nothing to remember in restricted browsing modes.
  }
}

export function clearLockIntent(): void {
  try {
    window.sessionStorage.removeItem(LOCK_INTENT_KEY);
  } catch {
    // Nothing stored.
  }
}

/** True until the next successful unlock in this tab. */
export function wasLockedOnPurpose(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(LOCK_INTENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberDevice(info?: {
  credentialId?: string | null;
  label?: string;
}): RememberedDevice {
  const device = createRememberedDevice(info);
  try {
    window.localStorage.setItem(DEVICE_MEMORY_KEY, serialiseRememberedDevice(device));
  } catch {
    // The server cookie still remembers the device; only the hint is lost.
  }
  cached = device;
  clearLockIntent();
  emit();
  return device;
}

export function forgetRememberedDevice(): void {
  try {
    window.localStorage.removeItem(DEVICE_MEMORY_KEY);
  } catch {
    // Nothing cached to clear.
  }
  cached = null;
  emit();
}

/** Subscribes a component to the cache (null on the server and first paint). */
export function useRememberedDevice(): RememberedDevice | null {
  return useSyncExternalStore(subscribe, getRememberedDevice, getServerSnapshot);
}
