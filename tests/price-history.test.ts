import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAssetPriceSeries,
  computeDailyPriceRows,
  filterPricePointsByRange,
  latestDailyPriceChange,
} from "../src/lib/price-history";
import { verifyCronRequest } from "../src/app/api/cron/daily-snapshot/route";

test("buildAssetPriceSeries deduplicates dates, orders ascending, and appends today's snapshot price", () => {
  const series = buildAssetPriceSeries(
    [
      { date: "2026-10-20", price: 67500 },
      { date: "2026-10-19", price: 66800 },
      { date: "2026-10-20", price: 67900 },
      { date: "2026-10-18", price: 0 },
    ],
    68420,
    "2026-10-22",
  );

  assert.deepEqual(series, [
    { date: "2026-10-19", price: 66800 },
    { date: "2026-10-20", price: 67900 },
    { date: "2026-10-22", price: 68420 },
  ]);
});

test("computeDailyPriceRows and latestDailyPriceChange calculate accurate day-over-day changes", () => {
  const series = [
    { date: "2026-10-20", price: 100 },
    { date: "2026-10-21", price: 110 },
    { date: "2026-10-22", price: 99 },
  ];

  const rows = computeDailyPriceRows(series);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    date: "2026-10-22",
    price: 99,
    prevPrice: 110,
    change: -11,
    changePct: -0.1,
  });
  assert.deepEqual(rows[1], {
    date: "2026-10-21",
    price: 110,
    prevPrice: 100,
    change: 10,
    changePct: 0.1,
  });
  assert.deepEqual(rows[2], {
    date: "2026-10-20",
    price: 100,
    prevPrice: null,
    change: null,
    changePct: null,
  });

  const latest = latestDailyPriceChange(series);
  assert.deepEqual(latest, {
    change: -11,
    changePct: -0.1,
    prevDate: "2026-10-21",
    prevPrice: 110,
  });
  assert.equal(latestDailyPriceChange([{ date: "2026-10-22", price: 100 }]), null);
});

test("filterPricePointsByRange filters windows relative to latest snapshot and handles single-point ranges", () => {
  const points = [
    { date: "2025-06-01", price: 50 },
    { date: "2026-03-01", price: 80 },
    { date: "2026-10-01", price: 120 },
    { date: "2026-10-22", price: 135 },
  ];

  assert.equal(filterPricePointsByRange(points, "1M").length, 2);
  assert.equal(filterPricePointsByRange(points, "6M").length, 2);
  assert.equal(filterPricePointsByRange(points, "1Y").length, 3);
  assert.equal(filterPricePointsByRange(points, "ALL").length, 4);
});

test("verifyCronRequest allows unconfigured secret and enforces Bearer CRON_SECRET when set", () => {
  const unconfigured = verifyCronRequest(new Request("https://example.com/api/cron/daily-snapshot"), {});
  assert.equal(unconfigured, null);

  const missingToken = verifyCronRequest(new Request("https://example.com/api/cron/daily-snapshot"), {
    CRON_SECRET: "super-secret-cron-token",
  });
  assert.equal(missingToken?.status, 401);

  const wrongToken = verifyCronRequest(
    new Request("https://example.com/api/cron/daily-snapshot", {
      headers: { Authorization: "Bearer wrong-token" },
    }),
    { CRON_SECRET: "super-secret-cron-token" },
  );
  assert.equal(wrongToken?.status, 401);

  const validToken = verifyCronRequest(
    new Request("https://example.com/api/cron/daily-snapshot", {
      headers: { Authorization: "Bearer super-secret-cron-token" },
    }),
    { CRON_SECRET: "super-secret-cron-token" },
  );
  assert.equal(validToken, null);
});
