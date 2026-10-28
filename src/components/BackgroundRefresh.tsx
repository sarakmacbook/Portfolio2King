"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { backgroundRefreshPrices } from "@/app/alert-actions";
import { DEFAULT_ALERT_SETTINGS } from "@/lib/alert-rules";
import { PRICE_SETTINGS_CHANGED_EVENT } from "@/lib/price-update-events";

type RefreshConfig = {
  /** `0` means background updates are switched off entirely. */
  minutes: number;
  /** Whether a fetch that lands new prices should redraw the page. */
  autoRefresh: boolean;
};

const DEFAULTS: RefreshConfig = {
  minutes: DEFAULT_ALERT_SETTINGS.backgroundRefreshMinutes,
  autoRefresh: DEFAULT_ALERT_SETTINGS.autoRefresh,
};

/** Reads Settings → Price updates; falls back to the defaults when offline. */
async function loadConfig(): Promise<RefreshConfig> {
  try {
    const response = await fetch("/api/alerts/status", { cache: "no-store" });
    if (!response.ok) return DEFAULTS;
    const data = (await response.json()) as {
      settings?: { backgroundRefreshMinutes?: number; autoRefresh?: boolean };
    };
    return {
      minutes:
        typeof data.settings?.backgroundRefreshMinutes === "number"
          ? data.settings.backgroundRefreshMinutes
          : DEFAULTS.minutes,
      autoRefresh:
        typeof data.settings?.autoRefresh === "boolean"
          ? data.settings.autoRefresh
          : DEFAULTS.autoRefresh,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Keeps prices fresh while the app is open.
 *
 * Two settings drive it, and they are independent by design:
 * `backgroundRefreshMinutes` decides whether anything is fetched at all (`0`
 * stops the timer), and `autoRefresh` decides whether the current view is
 * redrawn when a fetch brings back new prices. With auto refresh off the feed
 * still moves — the screen just holds still until the next navigation.
 *
 * A successful save on Settings → Price updates broadcasts
 * `PRICE_SETTINGS_CHANGED_EVENT`, which restarts the timer with the new values
 * without a reload.
 */
export default function BackgroundRefresh() {
  const router = useRouter();
  const running = useRef(false);
  // Read inside the timer callback, so flipping the setting does not need the
  // interval to be torn down mid-flight to take effect on the very next tick.
  const autoRefresh = useRef(DEFAULTS.autoRefresh);

  const run = useCallback(() => {
    if (running.current || document.visibilityState === "hidden") return;
    running.current = true;
    void backgroundRefreshPrices()
      .then((result) => {
        if (result.refreshed > 0 && autoRefresh.current) router.refresh();
      })
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
      });
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let initial: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (initial) clearTimeout(initial);
      if (interval) clearInterval(interval);
      initial = null;
      interval = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") run();
    };

    async function start() {
      stop();
      const config = await loadConfig();
      if (cancelled) return;
      autoRefresh.current = config.autoRefresh;
      if (config.minutes <= 0) {
        // Off: no timer, and no listener — nothing can fire.
        document.removeEventListener("visibilitychange", onVisibilityChange);
        return;
      }
      const ms = Math.max(5, config.minutes) * 60_000;
      initial = setTimeout(run, 5_000);
      interval = setInterval(run, ms);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    // Restarting re-reads the settings and rebuilds the timers from scratch.
    const onSettingsChanged = () => {
      void start();
    };

    void start();
    window.addEventListener(PRICE_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(PRICE_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    };
  }, [run]);

  return null;
}
