"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PRIVACY_STORAGE_KEY,
  maskSensitiveText,
} from "@/lib/privacy";
import type { PasskeySummary } from "@/lib/privacy-db";
import { Modal } from "./ui";

type DialogMode = "setPin" | "managePin" | "revealPin" | null;

type PrivacyContextValue = {
  hasPin: boolean;
  hasPasskey: boolean;
  passkeys: PasskeySummary[];
  locked: boolean;
  hidden: boolean;
  openDialog: (mode: Exclude<DialogMode, null>) => void;
  hideBalances: () => Promise<void>;
  requestRevealBalances: () => Promise<void>;
  lockPortfolio: () => Promise<void>;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within PrivacyProvider");
  return ctx;
}

function syncHtmlPrivacyClass(active: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("privacy-hidden", active);
  try {
    if (active) localStorage.setItem(PRIVACY_STORAGE_KEY, "1");
    else localStorage.removeItem(PRIVACY_STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted browsing modes.
  }
}

export function base64urlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bufferToBase64url(input: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    input instanceof Uint8Array
      ? input
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

function detectPasskeyDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Face ID / Passkey";
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone Face ID / Passkey";
  if (/iPad/i.test(ua)) return "iPad Face ID / Touch ID";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac Touch ID / Passkey";
  if (/Android/i.test(ua)) return "Android Biometric Passkey";
  return "Face ID / Passkey";
}

type AttestationResponseWithHelpers = AuthenticatorAttestationResponse & {
  getPublicKey?: () => ArrayBuffer | null;
  getPublicKeyAlgorithm?: () => number;
  getAuthenticatorData?: () => ArrayBuffer;
};

async function runBrowserPasskeyRegistration(options: {
  challenge: string;
  rpName?: string;
  user: { id: string; name: string; displayName: string };
}): Promise<{
  credentialId: string;
  clientDataJSON: string;
  publicKeySpki?: string;
  authenticatorData?: string;
  alg: number;
  label: string;
}> {
  if (!isWebAuthnSupported()) {
    throw new Error(
      "Face ID / Passkey requires Safari or a modern browser over HTTPS or localhost.",
    );
  }
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: base64urlToUint8Array(options.challenge),
      rp: {
        name: options.rpName || "Ledgerly",
      },
      user: {
        id: base64urlToUint8Array(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        userVerification: "preferred",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Face ID / Passkey setup was cancelled.");
  }

  const response = credential.response as AttestationResponseWithHelpers;
  const spkiBuffer =
    typeof response.getPublicKey === "function" ? response.getPublicKey() : null;
  const authDataBuffer =
    typeof response.getAuthenticatorData === "function"
      ? response.getAuthenticatorData()
      : null;
  const alg =
    typeof response.getPublicKeyAlgorithm === "function"
      ? response.getPublicKeyAlgorithm()
      : -7;

  return {
    credentialId: bufferToBase64url(credential.rawId),
    clientDataJSON: bufferToBase64url(response.clientDataJSON),
    publicKeySpki: spkiBuffer ? bufferToBase64url(spkiBuffer) : undefined,
    authenticatorData: authDataBuffer ? bufferToBase64url(authDataBuffer) : undefined,
    alg,
    label: detectPasskeyDeviceLabel(),
  };
}

async function runBrowserPasskeyAssertion(options: {
  challenge: string;
  credentialIds: string[];
}): Promise<{
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}> {
  if (!isWebAuthnSupported()) {
    throw new Error("Face ID / Passkey is not available in this browser.");
  }
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: base64urlToUint8Array(options.challenge),
      allowCredentials: options.credentialIds.map((id) => ({
        type: "public-key" as const,
        id: base64urlToUint8Array(id),
      })),
      userVerification: "preferred",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Face ID / Passkey authentication was cancelled.");
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: bufferToBase64url(credential.rawId),
    clientDataJSON: bufferToBase64url(response.clientDataJSON),
    authenticatorData: bufferToBase64url(response.authenticatorData),
    signature: bufferToBase64url(response.signature),
  };
}

export function PrivacyProvider({
  initialHasPin,
  initialHasPasskey = false,
  initialPasskeys = [],
  initialLocked,
  initialHidden,
  children,
}: {
  initialHasPin: boolean;
  initialHasPasskey?: boolean;
  initialPasskeys?: PasskeySummary[];
  initialLocked: boolean;
  initialHidden: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [hasPasskey, setHasPasskey] = useState(initialHasPasskey);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>(initialPasskeys);
  const [locked, setLocked] = useState(initialLocked);
  const [hidden, setHidden] = useState(() => {
    if (initialLocked || initialHidden) return true;
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem(PRIVACY_STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    }
    return false;
  });
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [pinInput, setPinInput] = useState("");
  const [confirmPinInput, setConfirmPinInput] = useState("");
  const [currentPinInput, setCurrentPinInput] = useState("");
  const [lockImmediately, setLockImmediately] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasLock = hasPin || hasPasskey;

  useEffect(() => {
    syncHtmlPrivacyClass(hidden || locked);
  }, [hidden, locked]);

  function openDialog(mode: Exclude<DialogMode, null>) {
    setPinInput("");
    setConfirmPinInput("");
    setCurrentPinInput("");
    setError("");
    setLockImmediately(true);
    setDialogMode(mode);
  }

  function closeDialog() {
    if (busy) return;
    setDialogMode(null);
    setPinInput("");
    setConfirmPinInput("");
    setCurrentPinInput("");
    setError("");
  }

  const hideBalances = useCallback(async () => {
    setHidden(true);
    syncHtmlPrivacyClass(true);
    try {
      await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ action: "hide" }),
      });
    } catch {
      // Local hidden state is already active.
    }
  }, []);

  const handleRevealWithPasskey = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const optRes = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ action: "passkeyAuthOptions" }),
      });
      const optData = (await optRes.json().catch(() => ({}))) as {
        error?: string;
        challenge?: string;
        challengeToken?: string;
        credentialIds?: string[];
      };
      if (!optRes.ok || !optData.challenge || !optData.challengeToken) {
        throw new Error(optData.error || "Could not start Face ID / Passkey check.");
      }

      const assertion = await runBrowserPasskeyAssertion({
        challenge: optData.challenge,
        credentialIds: optData.credentialIds ?? [],
      });

      const verifyRes = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "revealPasskey",
          ...assertion,
          challengeToken: optData.challengeToken,
        }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || "Face ID / Passkey verification failed.");
      }

      setLocked(false);
      setHidden(false);
      syncHtmlPrivacyClass(false);
      setDialogMode(null);
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Face ID / Passkey prompt was cancelled."
          : err instanceof Error
            ? err.message
            : "Face ID / Passkey verification failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [router]);

  const requestRevealBalances = useCallback(async () => {
    if (hasLock) {
      openDialog("revealPin");
      return;
    }
    setHidden(false);
    syncHtmlPrivacyClass(false);
    try {
      await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ action: "reveal" }),
      });
    } catch {
      // Ignore network error for local-only reveal.
    }
  }, [hasLock]);

  const lockPortfolio = useCallback(async () => {
    if (!hasLock) {
      openDialog("setPin");
      return;
    }
    setLocked(true);
    setHidden(true);
    syncHtmlPrivacyClass(true);
    try {
      await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ action: "lock" }),
      });
      router.refresh();
    } catch {
      // Local lock state is already active.
    }
  }, [hasLock, router]);

  async function handleRegisterPasskey() {
    setError("");
    setBusy(true);
    try {
      const optRes = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "passkeyRegisterOptions",
          currentPin: hasPin ? currentPinInput : undefined,
        }),
      });
      const optData = (await optRes.json().catch(() => ({}))) as {
        error?: string;
        challenge?: string;
        challengeToken?: string;
        rpName?: string;
        user?: { id: string; name: string; displayName: string };
      };
      if (!optRes.ok || !optData.challenge || !optData.challengeToken || !optData.user) {
        throw new Error(optData.error || "Could not start Face ID / Passkey setup.");
      }

      const registration = await runBrowserPasskeyRegistration({
        challenge: optData.challenge,
        rpName: optData.rpName,
        user: optData.user,
      });

      const regRes = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "passkeyRegister",
          ...registration,
          challengeToken: optData.challengeToken,
          currentPin: hasPin ? currentPinInput : undefined,
          lockNow: lockImmediately,
        }),
      });
      const regData = (await regRes.json().catch(() => ({}))) as {
        error?: string;
        hasPin?: boolean;
        hasPasskey?: boolean;
        passkeys?: PasskeySummary[];
        locked?: boolean;
        hidden?: boolean;
      };
      if (!regRes.ok) {
        throw new Error(regData.error || "Could not save Face ID / Passkey.");
      }

      setHasPin(Boolean(regData.hasPin));
      setHasPasskey(Boolean(regData.hasPasskey));
      setPasskeys(regData.passkeys ?? []);
      setLocked(Boolean(regData.locked));
      setHidden(Boolean(regData.hidden));
      syncHtmlPrivacyClass(Boolean(regData.hidden || regData.locked));
      setDialogMode(null);
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Face ID / Passkey setup was cancelled or blocked by your browser."
          : err instanceof Error
            ? err.message
            : "Could not register Face ID / Passkey.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePasskey(credentialId: string) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "removePasskey",
          credentialId,
          currentPin: hasPin ? currentPinInput : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        hasPin?: boolean;
        hasPasskey?: boolean;
        passkeys?: PasskeySummary[];
        locked?: boolean;
        hidden?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || "Could not remove Face ID / Passkey.");
      }
      setHasPin(Boolean(data.hasPin));
      setHasPasskey(Boolean(data.hasPasskey));
      setPasskeys(data.passkeys ?? []);
      setLocked(Boolean(data.locked));
      setHidden(Boolean(data.hidden));
      syncHtmlPrivacyClass(Boolean(data.hidden || data.locked));
      if (!data.hasPin && !data.hasPasskey) {
        setDialogMode(null);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove Face ID / Passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const trimmed = pinInput.trim();
    if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) {
      setError(
        `PIN or passcode must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters.`,
      );
      return;
    }
    if (trimmed !== confirmPinInput.trim()) {
      setError("PIN confirmation does not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "setPin",
          pin: trimmed,
          currentPin: hasPin ? currentPinInput : undefined,
          lockNow: lockImmediately,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        hasPin?: boolean;
        hasPasskey?: boolean;
        passkeys?: PasskeySummary[];
        locked?: boolean;
        hidden?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not save PIN.");
      }
      setHasPin(true);
      setHasPasskey(Boolean(data.hasPasskey));
      if (data.passkeys) setPasskeys(data.passkeys);
      setLocked(Boolean(data.locked));
      setHidden(Boolean(data.hidden));
      syncHtmlPrivacyClass(Boolean(data.hidden || data.locked));
      setDialogMode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePin() {
    setError("");
    if (!currentPinInput.trim()) {
      setError("Enter your current PIN to remove the PIN lock.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "removePin",
          currentPin: currentPinInput,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        hasPin?: boolean;
        hasPasskey?: boolean;
        passkeys?: PasskeySummary[];
        locked?: boolean;
        hidden?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not remove PIN.");
      }
      setHasPin(false);
      setHasPasskey(Boolean(data.hasPasskey));
      setPasskeys(data.passkeys ?? []);
      setLocked(Boolean(data.locked));
      setHidden(Boolean(data.hidden));
      syncHtmlPrivacyClass(Boolean(data.hidden || data.locked));
      setDialogMode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevealWithPin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "reveal",
          pin: pinInput,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Incorrect PIN.");
      }
      setLocked(false);
      setHidden(false);
      syncHtmlPrivacyClass(false);
      setDialogMode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PrivacyContext.Provider
      value={{
        hasPin,
        hasPasskey,
        passkeys,
        locked,
        hidden,
        openDialog,
        hideBalances,
        requestRevealBalances,
        lockPortfolio,
      }}
    >
      {children}

      <Modal
        open={dialogMode === "setPin" || dialogMode === "managePin"}
        onClose={closeDialog}
        title={hasLock ? "Manage privacy lock (Face ID, Passkey & PIN)" : "Set privacy lock"}
      >
        <div className="space-y-5">
          <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-indigo-900">
                  🪪 Face ID / Touch ID / Passkey
                </h4>
                <p className="mt-0.5 text-xs text-slate-600">
                  Unlock your portfolio on iPhone with Face ID or Touch ID, or sync via iCloud Passkeys.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => void handleRegisterPasskey()}
                disabled={busy}
              >
                {busy
                  ? "Waiting…"
                  : hasPasskey
                    ? "+ Add Face ID / Passkey"
                    : "Enable Face ID / Passkey"}
              </button>
            </div>

            {passkeys.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {passkeys.map((pk) => (
                  <li
                    key={pk.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700"
                  >
                    <span className="font-medium text-slate-900">
                      🪪 {pk.label}
                    </span>
                    <button
                      type="button"
                      className="btn-danger px-2.5 py-1 text-xs"
                      onClick={() => void handleRemovePasskey(pk.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleSavePin} className="space-y-4">
            <p className="text-sm text-slate-600">
              {hasPin
                ? "Your portfolio also has a PIN / passcode configured. Enter your current PIN to change or remove it."
                : "You can also set a numeric PIN or passcode (optional if Face ID / Passkey is enabled)."}
            </p>

            {hasPin && (
              <div>
                <label className="label" htmlFor="privacy-current-pin">
                  Current PIN / passcode
                </label>
                <input
                  id="privacy-current-pin"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  placeholder="Enter current PIN"
                  value={currentPinInput}
                  onChange={(e) => setCurrentPinInput(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="privacy-new-pin">
                  {hasPin ? "New PIN / passcode" : "PIN / passcode"}
                </label>
                <input
                  id="privacy-new-pin"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  placeholder="4–32 characters"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="privacy-confirm-pin">
                  Confirm PIN
                </label>
                <input
                  id="privacy-confirm-pin"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  placeholder="Repeat PIN"
                  value={confirmPinInput}
                  onChange={(e) => setConfirmPinInput(e.target.value)}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={lockImmediately}
                onChange={(e) => setLockImmediately(e.target.checked)}
              />
              <span>Lock portfolio immediately after saving</span>
            </label>

            {error && (
              <p
                role="alert"
                className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200"
              >
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {hasPin ? (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void handleRemovePin()}
                  disabled={busy}
                >
                  Remove PIN lock
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={closeDialog}
                  disabled={busy}
                >
                  Close
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : hasPin ? "Update PIN" : "Save PIN"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        open={dialogMode === "revealPin"}
        onClose={closeDialog}
        title="Verify to reveal balances"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Hidden mode is active. Verify with Face ID / Passkey or your PIN to unmask your portfolio numbers.
          </p>

          {hasPasskey && (
            <button
              type="button"
              onClick={() => void handleRevealWithPasskey()}
              disabled={busy}
              className="btn-primary w-full py-2.5"
            >
              {busy ? "Verifying Face ID / Passkey…" : "🪪 Reveal with Face ID / Passkey"}
            </button>
          )}

          {hasPin && (
            <form onSubmit={handleRevealWithPin} className="space-y-4">
              <div>
                <label className="label" htmlFor="privacy-reveal-pin">
                  {hasPasskey ? "Or enter PIN / passcode" : "PIN / passcode"}
                </label>
                <input
                  id="privacy-reveal-pin"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  placeholder="Enter PIN"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  autoFocus={!hasPasskey}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={closeDialog}
                  disabled={busy}
                >
                  Keep hidden
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? "Verifying…" : "Reveal with PIN"}
                </button>
              </div>
            </form>
          )}

          {!hasPin && (
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-ghost"
                onClick={closeDialog}
                disabled={busy}
              >
                Keep hidden
              </button>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200"
            >
              {error}
            </p>
          )}
        </div>
      </Modal>
    </PrivacyContext.Provider>
  );
}

export function PrivacyHeaderControl() {
  const {
    hasPin,
    hasPasskey,
    locked,
    hidden,
    openDialog,
    hideBalances,
    requestRevealBalances,
    lockPortfolio,
  } = usePrivacy();
  const hasLock = hasPin || hasPasskey;

  if (locked) {
    return (
      <span
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-xs font-semibold text-white ring-1 ring-white/20"
        title="Portfolio is locked"
      >
        <span aria-hidden="true">🔒</span>
        <span>Locked</span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void (hidden ? requestRevealBalances() : hideBalances())}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/10"
        aria-pressed={hidden}
        aria-label={hidden ? "Reveal hidden balances" : "Hide portfolio balances"}
        title={
          hidden
            ? hasLock
              ? "Reveal balances (Face ID / Passkey or PIN required)"
              : "Show portfolio balances"
            : "Hide all balances (••••••)"
        }
      >
        <span aria-hidden="true">{hidden ? "🙈" : "👁"}</span>
        <span className="hidden sm:inline">{hidden ? "Hidden" : "Hide"}</span>
      </button>

      {hasLock ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void lockPortfolio()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/10"
            aria-label="Lock portfolio now"
            title="Lock portfolio now (requires Face ID, Passkey, or PIN to view)"
          >
            <span aria-hidden="true">🔒</span>
            <span className="hidden sm:inline">Lock</span>
          </button>
          <button
            type="button"
            onClick={() => openDialog("managePin")}
            className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-xs text-white ring-1 ring-white/20 transition hover:bg-white/10"
            aria-label="Manage privacy lock"
            title="Manage Face ID / Passkey or PIN lock"
          >
            {hasPasskey ? "🪪" : "🔑"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openDialog("setPin")}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/10"
          aria-label="Set privacy lock"
          title="Set Face ID, Passkey, or PIN lock for your portfolio"
        >
          <span aria-hidden="true">🔒</span>
          <span className="hidden sm:inline">Lock setup</span>
        </button>
      )}
    </div>
  );
}

function PrivacyLockScreen() {
  const router = useRouter();
  const { hasPin, hasPasskey } = usePrivacy();
  const [pin, setPin] = useState("");
  const [keepHidden, setKeepHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleUnlockWithPasskey() {
    setError("");
    setBusy(true);
    try {
      const optRes = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ action: "passkeyAuthOptions" }),
      });
      const optData = (await optRes.json().catch(() => ({}))) as {
        error?: string;
        challenge?: string;
        challengeToken?: string;
        credentialIds?: string[];
      };
      if (!optRes.ok || !optData.challenge || !optData.challengeToken) {
        throw new Error(optData.error || "Could not start Face ID / Passkey unlock.");
      }

      const assertion = await runBrowserPasskeyAssertion({
        challenge: optData.challenge,
        credentialIds: optData.credentialIds ?? [],
      });

      const verifyRes = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "unlockPasskey",
          ...assertion,
          challengeToken: optData.challengeToken,
          keepHidden,
        }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || "Face ID / Passkey verification failed.");
      }

      syncHtmlPrivacyClass(keepHidden);
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Face ID / Passkey unlock was cancelled."
          : err instanceof Error
            ? err.message
            : "Face ID / Passkey verification failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function submitUnlock(event: React.FormEvent, unlockHidden: boolean) {
    event.preventDefault();
    setError("");
    if (!pin.trim()) {
      setError("Enter your PIN or passcode.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/privacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          action: "unlock",
          pin,
          keepHidden: unlockHidden,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Incorrect PIN or passcode.");
      }
      syncHtmlPrivacyClass(unlockHidden);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect PIN or passcode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="privacy-exempt card mx-auto my-8 max-w-md p-6 text-center sm:p-8">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-2xl text-indigo-700 ring-1 ring-indigo-200">
        {hasPasskey ? "🪪" : "🔒"}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Portfolio is locked
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Private mode is active. Authenticate with{" "}
        {hasPasskey && hasPin
          ? "Face ID / Passkey or your PIN"
          : hasPasskey
            ? "Face ID or your Passkey"
            : "your PIN or passcode"}{" "}
        to view your portfolio.
      </p>

      <div className="mt-6 space-y-4 text-left">
        {hasPasskey && (
          <button
            type="button"
            onClick={() => void handleUnlockWithPasskey()}
            disabled={busy}
            className="btn-primary w-full py-3 text-base"
          >
            {busy ? "Verifying Face ID / Passkey…" : "🪪 Unlock with Face ID / Passkey"}
          </button>
        )}

        {(hasPin || !hasPasskey) && (
          <form
            onSubmit={(e) => void submitUnlock(e, keepHidden)}
            className="space-y-4"
          >
            <div>
              <label className="label" htmlFor="unlock-portfolio-pin">
                {hasPasskey ? "Or unlock with PIN / passcode" : "PIN / passcode"}
              </label>
              <input
                id="unlock-portfolio-pin"
                type="password"
                autoComplete="current-password"
                className="input text-center text-base tracking-widest"
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus={!hasPasskey}
                required
              />
            </div>

            <button
              type="submit"
              className={hasPasskey ? "btn-ghost w-full" : "btn-primary w-full"}
              disabled={busy}
            >
              {busy ? "Unlocking…" : "Unlock with PIN"}
            </button>
          </form>
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={keepHidden}
            onChange={(e) => setKeepHidden(e.target.checked)}
          />
          <span>Keep dollar amounts &amp; balances masked (••••••) after unlocking</span>
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function PrivacyGate({ children }: { children: ReactNode }) {
  const {
    hasPin,
    hasPasskey,
    locked,
    hidden,
    requestRevealBalances,
    lockPortfolio,
    openDialog,
  } = usePrivacy();
  const hasLock = hasPin || hasPasskey;
  const containerRef = useRef<HTMLDivElement>(null);
  const originalsRef = useRef<WeakMap<Text, string>>(new WeakMap());

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const originals = originalsRef.current;

    function isInsideExempt(node: Node): boolean {
      let current: Node | null = node.parentNode;
      while (current && current !== root) {
        if (current instanceof HTMLElement) {
          const tag = current.tagName;
          if (
            tag === "SCRIPT" ||
            tag === "STYLE" ||
            tag === "TEXTAREA" ||
            current.classList.contains("privacy-exempt")
          ) {
            return true;
          }
        }
        current = current.parentNode;
      }
      return false;
    }

    function isInsideTabular(node: Node): boolean {
      let current: Node | null = node.parentNode;
      while (current && current !== root) {
        if (current instanceof HTMLElement && current.classList.contains("tabular-nums")) {
          return true;
        }
        current = current.parentNode;
      }
      return false;
    }

    function applyMasking() {
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let current = walker.nextNode();
      while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
      }
      for (const textNode of nodes) {
        if (isInsideExempt(textNode)) continue;
        const original = originals.get(textNode) ?? textNode.nodeValue ?? "";
        if (!hidden) {
          if (originals.has(textNode)) {
            if (textNode.nodeValue !== original) {
              textNode.nodeValue = original;
            }
            originals.delete(textNode);
          }
          continue;
        }
        const masked = maskSensitiveText(original, isInsideTabular(textNode));
        if (masked !== original) {
          if (!originals.has(textNode)) {
            originals.set(textNode, original);
          }
          if (textNode.nodeValue !== masked) {
            textNode.nodeValue = masked;
          }
        }
      }
    }

    applyMasking();
    if (!hidden) return;

    const observer = new MutationObserver(() => {
      applyMasking();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [hidden, locked, children]);

  if (locked) {
    return <PrivacyLockScreen />;
  }

  return (
    <div ref={containerRef}>
      {hidden && (
        <div className="privacy-exempt mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 text-xs text-slate-700 sm:text-sm">
          <span className="flex items-center gap-2 font-medium text-indigo-900">
            <span aria-hidden="true">🙈</span>
            <span>
              Hidden mode is on — all balances and quantities are masked (••••••).
            </span>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void requestRevealBalances()}
              className="btn-ghost px-3 py-1 text-xs"
            >
              {hasPasskey
                ? "🪪 Reveal with Face ID / Passkey"
                : hasPin
                  ? "🔑 Enter PIN to reveal"
                  : "👁 Reveal numbers"}
            </button>
            {hasLock ? (
              <button
                type="button"
                onClick={() => void lockPortfolio()}
                className="btn-primary px-3 py-1 text-xs"
              >
                🔒 Lock portfolio
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openDialog("setPin")}
                className="btn-primary px-3 py-1 text-xs"
              >
                🔒 Set Face ID / PIN lock
              </button>
            )}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
