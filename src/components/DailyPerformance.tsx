"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cryptoUnrealizedChange, type DailyCryptoHolding } from "@/lib/daily-crypto";
import { dayKeyInTimeZone } from "@/lib/daily-realized";
import { money, pnlColor } from "@/lib/format";

export type DailyPerformanceProps = {
  holdings: DailyCryptoHolding[];
  realized: number;
  allTimeRealized: number;
  day: string;
  timeZone: string;
};

/**
 * Live prices are display-only; they never write prices or trigger alerts.
 *
 * Real-time changes apply to volatile crypto only: stablecoins are pegged to
 * the dollar, so they keep their saved price and are never re-quoted — the card
 * counts them at their stored price and says so.
 */
export default function DailyPerformance({ holdings, realized, allTimeRealized, day, timeZone }: DailyPerformanceProps) {
  const router = useRouter();
  const [prices, setPrices] = useState<Record<number, number>>({});
  const [status, setStatus] = useState<"waiting" | "live" | "partial">("waiting");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    const successfulProviders = new Map<number, string>();
    // Real-time quotes for volatile crypto only; stablecoins keep their saved price.
    const assets = holdings.filter(
      (h) => h.quantity !== 0 && h.symbol.trim() && h.openingUnrealized !== null && h.cryptoCategory !== "stablecoin",
    );
    const poll = async () => {
      if (document.hidden || assets.length === 0) {
        if (!stopped) timer = setTimeout(poll, 1000);
        return;
      }
      controller = new AbortController();
      let found = 0;
      const next: Record<number, number> = {};
      try {
        const requests = [];
        for (let i = 0; i < assets.length; i += 50) {
          requests.push(fetch("/api/prices/live", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "bybit", fallback: true, assets: assets.slice(i, i + 50).map((a) => ({ id: a.id, symbol: a.symbol, type: "crypto", provider: successfulProviders.get(a.id) ?? a.provider })) }),
            cache: "no-store",
            signal: controller.signal,
          }).then(async (response) => {
            if (!response.ok) throw new Error("Quote unavailable");
            return response.json() as Promise<{ results: Array<{ id: number; price?: number; provider?: string }> }>;
          }));
        }
        const batches = await Promise.allSettled(requests);
        for (const batch of batches) {
          if (batch.status !== "fulfilled" || !Array.isArray(batch.value.results)) continue;
          for (const result of batch.value.results) {
            if (typeof result.price === "number" && Number.isFinite(result.price) && result.price > 0 && assets.some((asset) => asset.id === result.id)) {
              next[result.id] = result.price;
              if (result.provider) successfulProviders.set(result.id, result.provider);
              found++;
            }
          }
        }
        if (!stopped) {
          setPrices((current) => ({ ...current, ...next }));
          setStatus(found === assets.length ? "live" : "partial");
          failures = found === assets.length ? 0 : Math.min(failures + 1, 5);
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, failures ? Math.min(1000 * 2 ** failures, 30000) : 1000);
      }
    };
    void poll();
    return () => { stopped = true; controller?.abort(); if (timer) clearTimeout(timer); };
  }, [holdings]);

  useEffect(() => {
    let refreshedDay = day;
    const timer = setInterval(() => {
      const current = dayKeyInTimeZone(new Date(), timeZone);
      if (current !== refreshedDay) { refreshedDay = current; router.refresh(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [day, timeZone, router]);

  const total = realized + cryptoUnrealizedChange(holdings, prices);
  const missingBaseline = holdings.some((holding) => holding.openingUnrealized === null);
  const estimatedBaseline = holdings.some((holding) => holding.estimatedBaseline);
  const unquotable = holdings.some((holding) => holding.quantity !== 0 && !holding.symbol.trim() && holding.openingUnrealized !== null);
  const unpriced = holdings.some((holding) => holding.quantity !== 0 && holding.openingUnrealized !== null && !(prices[holding.id] > 0) && !(holding.price > 0));
  const stablecoinHeld = holdings.some((holding) => holding.cryptoCategory === "stablecoin" && holding.quantity !== 0 && holding.openingUnrealized !== null);
  const quoteStatus = status === "partial" || unquotable ? "Some prices unavailable · Last price used" : status === "live" ? "Live prices" : "Using saved prices";
  return <>
    <p className={`mt-2 truncate text-lg font-semibold tabular-nums sm:text-xl ${pnlColor(total)}`}>{money(total, { sign: true })}</p>
    <p className="mt-0.5 text-xs text-slate-500">Today’s P/L + crypto · All-time realized {money(allTimeRealized, { sign: true })}</p>
    <p className="mt-0.5 text-xs text-slate-500">{quoteStatus} · {estimatedBaseline ? "Some start at today’s first saved price" : "vs. last snapshot"}{stablecoinHeld ? " · Stablecoins use saved prices" : ""}{missingBaseline ? " · Some crypto skipped: no starting price" : ""}{unpriced ? " · Unpriced crypto skipped" : ""}</p>
  </>;
}
