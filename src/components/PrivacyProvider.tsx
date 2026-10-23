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
import { Modal } from "./ui";

type DialogMode = "setPin" | "managePin" | "revealPin" | null;

type PrivacyContextValue = {
  hasPin: boolean;
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

export function PrivacyProvider({
  initialHasPin,
  initialLocked,
  initialHidden,
  children,
}: {
  initialHasPin: boolean;
  initialLocked: boolean;
  initialHidden: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [hasPin, setHasPin] = useState(initialHasPin);
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

  const requestRevealBalances = useCallback(async () => {
    if (hasPin) {
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
  }, [hasPin]);

  const lockPortfolio = useCallback(async () => {
    if (!hasPin) {
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
  }, [hasPin, router]);

  async function handleSavePin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const trimmed = pinInput.trim();
    if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) {
      setError(`PIN or passcode must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters.`);
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
        locked?: boolean;
        hidden?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not save PIN.");
      }
      setHasPin(true);
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
      setError("Enter your current PIN to remove the lock.");
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not remove PIN.");
      }
      setHasPin(false);
      setLocked(false);
      setHidden(false);
      syncHtmlPrivacyClass(false);
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
        title={hasPin ? "Manage privacy PIN" : "Set privacy PIN"}
      >
        <form onSubmit={handleSavePin} className="space-y-4">
          <p className="text-sm text-slate-600">
            {hasPin
              ? "Your portfolio is protected by a PIN. Enter your current PIN to change or remove it."
              : "Protect your portfolio with a PIN or passcode so no one can view your holdings or unmask hidden balances without your permission."}
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
                autoFocus
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
                autoFocus={!hasPin}
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
              <button type="button" className="btn-ghost" onClick={closeDialog} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : hasPin ? "Update PIN" : "Enable PIN"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={dialogMode === "revealPin"}
        onClose={closeDialog}
        title="Enter PIN to reveal balances"
      >
        <form onSubmit={handleRevealWithPin} className="space-y-4">
          <p className="text-sm text-slate-600">
            Hidden mode is active. Enter your PIN or passcode to unmask your portfolio numbers.
          </p>
          <div>
            <label className="label" htmlFor="privacy-reveal-pin">
              PIN / passcode
            </label>
            <input
              id="privacy-reveal-pin"
              type="password"
              autoComplete="current-password"
              className="input"
              placeholder="Enter PIN"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={closeDialog} disabled={busy}>
              Keep hidden
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Verifying…" : "Reveal balances"}
            </button>
          </div>
        </form>
      </Modal>
    </PrivacyContext.Provider>
  );
}

export function PrivacyHeaderControl() {
  const {
    hasPin,
    locked,
    hidden,
    openDialog,
    hideBalances,
    requestRevealBalances,
    lockPortfolio,
  } = usePrivacy();

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
            ? hasPin
              ? "Reveal balances (PIN required)"
              : "Show portfolio balances"
            : "Hide all balances (••••••)"
        }
      >
        <span aria-hidden="true">{hidden ? "🙈" : "👁"}</span>
        <span className="hidden sm:inline">{hidden ? "Hidden" : "Hide"}</span>
      </button>

      {hasPin ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void lockPortfolio()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/10"
            aria-label="Lock portfolio now"
            title="Lock portfolio now (requires PIN to view)"
          >
            <span aria-hidden="true">🔒</span>
            <span className="hidden sm:inline">Lock</span>
          </button>
          <button
            type="button"
            onClick={() => openDialog("managePin")}
            className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-xs text-white ring-1 ring-white/20 transition hover:bg-white/10"
            aria-label="Manage privacy PIN"
            title="Change or remove privacy PIN"
          >
            🔑
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openDialog("setPin")}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/10"
          aria-label="Set PIN lock"
          title="Set a PIN or passcode to lock your portfolio"
        >
          <span aria-hidden="true">🔒</span>
          <span className="hidden sm:inline">PIN lock</span>
        </button>
      )}
    </div>
  );
}

function PrivacyLockScreen() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [keepHidden, setKeepHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
        🔒
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Portfolio is locked
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Private mode is active. No one can view your portfolio or balances without your PIN or passcode.
      </p>

      <form
        onSubmit={(e) => void submitUnlock(e, keepHidden)}
        className="mt-6 space-y-4 text-left"
      >
        <div>
          <label className="label" htmlFor="unlock-portfolio-pin">
            PIN / passcode
          </label>
          <input
            id="unlock-portfolio-pin"
            type="password"
            autoComplete="current-password"
            className="input text-center text-base tracking-widest"
            placeholder="••••••"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            required
          />
        </div>

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

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock portfolio"}
        </button>
      </form>
    </div>
  );
}

export function PrivacyGate({ children }: { children: ReactNode }) {
  const { hasPin, locked, hidden, requestRevealBalances, lockPortfolio, openDialog } =
    usePrivacy();
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
              {hasPin ? "🔑 Enter PIN to reveal" : "👁 Reveal numbers"}
            </button>
            {hasPin ? (
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
                🔒 Set PIN lock
              </button>
            )}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
