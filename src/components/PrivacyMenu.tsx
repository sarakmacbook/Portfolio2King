"use client";

import { useState } from "react";
import { usePrivacy } from "./PrivacyProvider";

/**
 * The *only* place that hides or reveals balances.
 *
 * It is rendered inside the one navigation menu (the ☰ sheet on phones, the
 * Privacy dropdown on desktop), so there is never a second eye/lock button in
 * the header, in a banner, or on a card that could get out of sync on iPhone.
 * The lock screen itself still owns unlocking, because that is a gate, not a
 * toggle.
 */
export function PrivacyMenuItems({
  onDone,
  compact = false,
}: {
  /** Called after an action so the surrounding menu can close. */
  onDone?: () => void;
  compact?: boolean;
}) {
  const {
    hasPin,
    hasPasskey,
    hidden,
    rememberedDevice,
    hideBalances,
    requestRevealBalances,
    lockPortfolio,
    forgetDevice,
    openDialog,
  } = usePrivacy();
  const hasLock = hasPin || hasPasskey;
  const [busy, setBusy] = useState(false);

  async function toggleHidden() {
    if (busy) return;
    setBusy(true);
    try {
      if (hidden) await requestRevealBalances();
      else await hideBalances();
    } finally {
      setBusy(false);
      onDone?.();
    }
  }

  function runLock() {
    onDone?.();
    void lockPortfolio();
  }

  function runForget() {
    onDone?.();
    void forgetDevice();
  }

  function openSettings() {
    onDone?.();
    openDialog(hasLock ? "managePin" : "setPin");
  }

  const row =
    "flex w-full items-center gap-3 rounded-xl px-3 text-left transition disabled:opacity-60";
  const size = compact ? "py-2.5" : "min-h-11 py-3";

  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={() => void toggleHidden()}
        disabled={busy}
        aria-pressed={hidden}
        aria-label={hidden ? "Reveal portfolio balances" : "Hide portfolio balances"}
        className={`${row} ${size} ${
          hidden
            ? "bg-indigo-50 text-indigo-700 hover:bg-slate-50"
            : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span className="text-base" aria-hidden="true">
          {hidden ? "🙈" : "👁"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {hidden ? "Reveal balances" : "Hide balances"}
          </span>
          <span className="block text-xs text-slate-500">
            {hidden
              ? hasLock
                ? "Face ID / Passkey or PIN required"
                : "Tap to show every amount again"
              : "Mask every amount with ••••••"}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            hidden ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {hidden ? "Hidden" : "Visible"}
        </span>
      </button>

      {hasLock && (
        <button
          type="button"
          onClick={runLock}
          className={`${row} ${size} text-slate-700 hover:bg-slate-50`}
        >
          <span className="text-base" aria-hidden="true">
            🔒
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Lock now</span>
            <span className="block text-xs text-slate-500">
              Require Face ID, Passkey or PIN to open again
            </span>
          </span>
        </button>
      )}

      {hasLock && rememberedDevice && (
        <button
          type="button"
          onClick={runForget}
          className={`${row} ${size} text-slate-700 hover:bg-slate-50`}
        >
          <span className="text-base" aria-hidden="true">
            🧹
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Forget this device</span>
            <span className="block text-xs text-slate-500">
              Require Face ID again on this browser
            </span>
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={openSettings}
        className={`${row} ${size} text-slate-700 hover:bg-slate-50`}
      >
        <span className="text-base" aria-hidden="true">
          {hasPasskey ? "🪪" : "🔑"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {hasLock ? "Manage Face ID / PIN" : "Set up Face ID / PIN lock"}
          </span>
          <span className="block text-xs text-slate-500">
            {hasPasskey
              ? "Passkey, Face ID and PIN options"
              : hasPin
                ? "PIN is set — add Face ID / Passkey"
                : "Protect the portfolio when it is open in public"}
          </span>
        </span>
      </button>

      {hasLock && (
        <p className="px-3 pt-1 text-[11px] leading-relaxed text-slate-400">
          {rememberedDevice
            ? `Remembered on this device: ${rememberedDevice.label}. Stays unlocked until you lock or forget it.`
            : "Not remembered yet — Face ID is asked once on this device."}
        </p>
      )}
    </div>
  );
}
