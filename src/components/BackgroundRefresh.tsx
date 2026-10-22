"use client";

import { useEffect, useRef } from "react";
import { backgroundRefreshPrices } from "@/app/alert-actions";

/**
 * Keeps prices fresh while the app is open: reads the configured interval from
 * the server and triggers a throttled background refresh. Refreshes are skipped
 * while the tab is hidden (browsers throttle timers there anyway), and the
 * server ignores runs that happen sooner than the interval.
 */
export default function BackgroundRefresh() {
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let initial: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      if (running.current || document.visibilityState === "hidden") return;
      running.current = true;
      void backgroundRefreshPrices()
        .catch(() => undefined)
        .finally(() => {
          running.current = false;
        });
    };

    async function start() {
      try {
        const response = await fetch("/api/alerts/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          settings?: { backgroundRefreshMinutes?: number };
        };
        const minutes = Number(data.settings?.backgroundRefreshMinutes) || 0;
        if (cancelled || minutes <= 0) return;
        const ms = Math.max(5, minutes) * 60_000;
        initial = setTimeout(run, 5_000);
        interval = setInterval(run, ms);
      } catch {
        // Offline or the server is unavailable — try again on the next page load.
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (initial) clearTimeout(initial);
      if (interval) clearInterval(interval);
    };
  }, []);

  return null;
}
