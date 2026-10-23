import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  DEVICE_MEMORY_KEY,
  LOCK_INTENT_KEY,
  createRememberedDevice,
  parseRememberedDevice,
  serialiseRememberedDevice,
} from "../src/lib/device-memory";

const rootDir = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(rootDir, path), "utf8");

test("remembered device record round-trips and is validated", () => {
  const device = createRememberedDevice(
    { credentialId: "cred-1", label: "iPhone Face ID / Passkey" },
    new Date("2026-10-23T09:00:00.000Z"),
  );
  assert.deepEqual(device, {
    credentialId: "cred-1",
    label: "iPhone Face ID / Passkey",
    rememberedAt: "2026-10-23T09:00:00.000Z",
  });

  const parsed = parseRememberedDevice(serialiseRememberedDevice(device));
  assert.deepEqual(parsed, device);

  // A PIN unlock has no credential but still remembers the device.
  const pinDevice = createRememberedDevice({ label: "PIN / passcode on this device" });
  assert.equal(pinDevice.credentialId, null);
  assert.equal(parseRememberedDevice(serialiseRememberedDevice(pinDevice))?.label, "PIN / passcode on this device");

  // Anything unreadable means "new device" instead of throwing.
  assert.equal(parseRememberedDevice(null), null);
  assert.equal(parseRememberedDevice(""), null);
  assert.equal(parseRememberedDevice("not-json"), null);
  assert.equal(parseRememberedDevice(JSON.stringify({ label: "x" })), null);
  assert.equal(
    parseRememberedDevice(JSON.stringify({ rememberedAt: "not-a-date" })),
    null,
  );

  // Labels are trimmed and capped, credentials are trimmed.
  const messy = parseRememberedDevice(
    JSON.stringify({
      credentialId: "  cred-2  ",
      label: `  ${"x".repeat(200)}  `,
      rememberedAt: "2026-10-23T09:00:00.000Z",
    }),
  );
  assert.equal(messy?.credentialId, "cred-2");
  assert.equal(messy?.label.length, 80);
});

test("the cache key is namespaced and never stores secrets", () => {
  assert.equal(DEVICE_MEMORY_KEY, "ledgerly-privacy-device");
  // Only a credential id, a label and a timestamp ever go into localStorage:
  // no PIN hash, session token, assertion or signature.
  const stored = JSON.parse(
    serialiseRememberedDevice(createRememberedDevice({ credentialId: "c", label: "l" })),
  );
  assert.deepEqual(Object.keys(stored).sort(), ["credentialId", "label", "rememberedAt"]);
  assert.equal(typeof stored.rememberedAt, "string");
});

test("a first-time visitor is asked for Face ID once, then remembered", () => {
  const provider = read("src/components/PrivacyProvider.tsx");
  const lockScreen = provider.slice(
    provider.indexOf("function PrivacyLockScreen()"),
    provider.indexOf("export function PrivacyGate"),
  );

  // Auto-prompt only when a passkey exists and nothing is cached yet.
  assert.ok(lockScreen.includes("if (!hasPasskey || rememberedDevice || autoPrompted.current) return;"));
  assert.ok(lockScreen.includes("handleUnlockWithPasskey({ silent: true })"));
  assert.ok(lockScreen.includes("void handleUnlockWithPasskey({ silent: true })"));

  // Both unlock paths write the cache, and a cancelled prompt falls back to PIN.
  assert.ok(lockScreen.includes("rememberThisDevice({"));
  assert.ok(lockScreen.includes("Use PIN instead"));
  assert.ok(lockScreen.includes("NotAllowedError"));
});

test("Lock now and Forget this device both clear the remembered unlock", () => {
  const provider = read("src/components/PrivacyProvider.tsx");
  const menu = read("src/components/PrivacyMenu.tsx");
  const route = read("src/app/api/privacy/route.ts");

  const lock = provider.slice(
    provider.indexOf("const lockPortfolio = useCallback"),
    provider.indexOf("const forgetDevice = useCallback"),
  );
  assert.ok(lock.includes("forgetRememberedDevice()"));
  assert.ok(lock.includes("markLockedOnPurpose()"));

  assert.ok(provider.includes("const forgetDevice = useCallback"));
  assert.ok(provider.includes('action: "forgetDevice"'));

  assert.ok(menu.includes("Forget this device"));
  assert.ok(menu.includes("void forgetDevice()"));

  assert.ok(route.includes('action === "forgetDevice"'));
  assert.ok(route.includes("remembered: false"));
});

test("an explicit lock suppresses the next automatic Face ID prompt", () => {
  const provider = read("src/components/PrivacyProvider.tsx");
  const memory = read("src/lib/device-memory.ts");

  // Scoped to the tab, never persisted alongside the remembered device.
  assert.equal(LOCK_INTENT_KEY, "ledgerly-privacy-lock-intent");
  assert.ok(memory.includes("sessionStorage.setItem(LOCK_INTENT_KEY"));
  assert.ok(memory.includes("sessionStorage.removeItem(LOCK_INTENT_KEY"));

  // A successful unlock clears the intent so auto-prompt resumes normally.
  const remember = memory.slice(memory.indexOf("export function rememberDevice"));
  assert.ok(remember.includes("clearLockIntent()"));

  // The lock screen checks it before prompting.
  const lockScreen = provider.slice(
    provider.indexOf("function PrivacyLockScreen()"),
    provider.indexOf("export function PrivacyGate"),
  );
  assert.ok(lockScreen.includes("if (wasLockedOnPurpose())"));
});

test("a remembered unlock outlives the 30-day session cookie", () => {
  const privacy = read("src/lib/privacy.ts");
  const route = read("src/app/api/privacy/route.ts");

  // Browsers cap cookie lifetime at 400 days; that is the "until I lock" max.
  assert.ok(privacy.includes("PRIVACY_DEVICE_MAX_AGE = 60 * 60 * 24 * 400"));
  assert.equal(route.includes("maxAge: 60 * 60 * 24 * 30"), false);
  assert.ok(route.includes("maxAge: PRIVACY_DEVICE_MAX_AGE"));
});
