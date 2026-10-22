"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PushState = "unsupported" | "checking" | "idle" | "subscribed" | "denied" | "error";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function serviceWorkerRegistration() {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration;
}

function isiOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function NotificationSetup({
  publicKey,
  subscribers,
}: {
  publicKey: string | null;
  subscribers: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<PushState>("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      setState(subscription ? "subscribed" : "idle");
    } catch {
      setState("idle");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Deferred so the effect body does not set state synchronously during render.
    void Promise.resolve().then(() => {
      if (!cancelled) setIosHint(isiOS() && !isStandalone());
      if (!cancelled) return refresh();
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function enable() {
    if (!publicKey) {
      setMessage("Push is unavailable until the database is connected.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "idle");
        setMessage("Notifications were not allowed. Enable them for this site in your browser settings.");
        return;
      }
      const registration = await serviceWorkerRegistration();
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const response = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save the subscription");
      setState("subscribed");
      setMessage("This browser will receive price alerts, even when the tab is in the background.");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/alerts/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("idle");
      setMessage("This browser will no longer receive alerts.");
      router.refresh();
    } catch {
      setMessage("Could not disable notifications in this browser.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            state === "subscribed" ? "bg-emerald-500" : state === "denied" ? "bg-rose-500" : "bg-slate-300"
          }`}
        />
        <span>
          {state === "subscribed"
            ? "This browser is subscribed"
            : state === "denied"
              ? "Notifications blocked in this browser"
              : state === "unsupported"
                ? "This browser does not support push notifications"
                : "Not subscribed on this browser"}
          {subscribers > 0 && <span className="text-slate-400"> · {subscribers} device{subscribers === 1 ? "" : "s"} registered</span>}
        </span>
      </div>

      {state === "unsupported" && (
        <p className="text-xs text-slate-500">
          Use a recent Chrome, Edge, Firefox, or Safari 16.4+ to receive price alerts.
        </p>
      )}

      {iosHint && state !== "unsupported" && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          On iPhone and iPad, add Ledgerly to your Home Screen first (Share → <strong>Add to Home Screen</strong>) and
          open it from there — iOS only delivers Web Push to installed web clips.
        </p>
      )}

      {state === "denied" && (
        <p className="text-xs text-slate-500">
          Allow notifications for this site in your browser settings, then reload this page.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {state === "subscribed" ? (
          <button type="button" className="btn-ghost" onClick={disable} disabled={busy}>
            {busy ? "Working…" : "Disable in this browser"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={enable}
            disabled={busy || state === "checking" || state === "unsupported" || state === "denied"}
          >
            {busy ? "Enabling…" : "Enable browser alerts"}
          </button>
        )}
      </div>

      {message && <p className="text-xs text-slate-500">{message}</p>}
      {!publicKey && <p className="text-xs text-rose-600">No push key yet — connect a database first.</p>}
    </div>
  );
}
