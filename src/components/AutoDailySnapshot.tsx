"use client";

import { useEffect } from "react";
import { ensureDailyLiveSnapshot } from "@/app/actions";

/**
 * Silently triggers at most one background live price + daily snapshot refresh
 * per browser session per calendar day when previous-day crypto prices are stale.
 */
export default function AutoDailySnapshot({
  stale,
  currentDate,
}: {
  stale: boolean;
  currentDate: string;
}) {
  useEffect(() => {
    if (!stale) return;
    const storageKey = `ledgerly:daily-snapshot:${currentDate}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Private browsing / restricted storage: still run once per mount.
    }
    void ensureDailyLiveSnapshot();
  }, [stale, currentDate]);

  return null;
}
