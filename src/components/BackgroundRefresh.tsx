"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { backgroundRefreshPrices } from "@/app/alert-actions";
import { DEFAULT_ALERT_SETTINGS } from "@/lib/alert-rules";

/**
 * Keeps prices fresh while the app is open: reads the configured interval from
 * the server (defaulting to every 10 minutes) and triggers a throttled
 * background refresh, revalidating the current view whenever prices change.
 */
export default function BackgroundRefresh() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let initial: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      if (running.current || document.visibilityState === "hidden") return;
      running.current = true;
      void backgroundRefreshPrices()
        .then((result) => {
          if (!cancelled && result.refreshed > 0) {
            router.refresh();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          running.current = false;
        });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };

    async function start() {
      let minutes = DEFAULT_ALERT_SETTINGS.backgroundRefreshMinutes;
      try {
        const response = await fetch("/api/alerts/status", { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as {
            settings?: { backgroundRefreshMinutes?: number };
          };
          if (typeof data.settings?.backgroundRefreshMinutes === "number") {
            minutes = data.settings.backgroundRefreshMinutes;
          }
        }
      } catch {
        // Fall back to the 10-minute default interval.
      }
      if (cancelled || minutes <= 0) return;
      const ms = Math.max(5, minutes) * 60_000;
      initial = setTimeout(run, 5_000);
      interval = setInterval(run, ms);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    void start();
    return () => {
      cancelled = true;
      if (initial) clearTimeout(initial);
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
