"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { autoRefreshPrices, type ActionState } from "@/app/actions";

function RefreshSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-ghost" disabled={pending} title="Refresh crypto prices from available exchanges">
      <svg
        viewBox="0 0 24 24"
        className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M6.1 9a7 7 0 0 1 11.7-2.6L20 11M4 13l2.2 4.6A7 7 0 0 0 17.9 15" />
      </svg>
      <span>{pending ? "Refreshing…" : "Refresh prices"}</span>
    </button>
  );
}

export default function RefreshPricesButton() {
  const [showMessage, setShowMessage] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (previous) => {
    setShowMessage(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const result = await autoRefreshPrices(previous);
    setShowMessage(true);
    hideTimer.current = setTimeout(() => setShowMessage(false), 3500);
    return result;
  }, {});
  return (
    <form action={action} className="relative">
      <RefreshSubmit />
      {showMessage && (state.message || state.error) && (
        <p
          role="status"
          className={`absolute right-0 top-full z-20 mt-2 w-64 rounded-xl px-3 py-2 text-xs shadow-lg ring-1 ${
            state.error ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"
          }`}
        >
          {state.error || state.message}
        </p>
      )}
    </form>
  );
}
