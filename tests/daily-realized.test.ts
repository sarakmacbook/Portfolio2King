import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dayKeyInTimeZone,
  groupTxsByAsset,
  realizedOnDay,
  sumDayRealized,
  type DatedTx,
} from "../src/lib/daily-realized";

const TODAY = "2026-10-28";
const YESTERDAY = "2026-10-27";

function tx(kind: DatedTx["kind"], quantity: number, price: number, date: string, fee = 0): DatedTx {
  return { kind, quantity, price, fee, date };
}

test("today's realised P/L counts today's sells against the cost basis of the day", () => {
  const ledger: DatedTx[] = [
    tx("buy", 10, 100, "2026-01-05"),
    // Sold after the cost basis doubled: only today's 5 units belong to today.
    tx("sell", 5, 150, TODAY),
  ];
  const day = realizedOnDay("stock", ledger, TODAY);
  assert.equal(day.total, 250);
  assert.equal(day.trades, 250);
  assert.equal(day.income, 0);
  assert.equal(day.count, 1);
});

test("a sell from yesterday is already booked and does not count today", () => {
  const ledger: DatedTx[] = [
    tx("buy", 10, 100, "2026-01-05"),
    tx("sell", 4, 150, YESTERDAY),
  ];
  const day = realizedOnDay("stock", ledger, TODAY);
  assert.equal(day.total, 0);
  assert.equal(day.count, 0);
  // The all-time replay is unchanged by the slice, so the two can be shown together.
  assert.equal(realizedOnDay("stock", ledger, YESTERDAY).total, 200);
});

test("the day rolls over at 12am, not at 24h after the last trade", () => {
  const ledger: DatedTx[] = [tx("buy", 1, 100, "2026-10-01"), tx("sell", 1, 130, "2026-10-28")];
  const justBeforeMidnight = realizedOnDay("crypto", ledger, "2026-10-28");
  const justAfterMidnight = realizedOnDay("crypto", ledger, "2026-10-29");
  assert.equal(justBeforeMidnight.total, 30);
  assert.equal(justAfterMidnight.total, 0);
});

test("income counts on the day it was paid and is split out from trades", () => {
  const ledger: DatedTx[] = [
    tx("buy", 10, 100, "2026-01-05"),
    tx("dividend", 20, 1, YESTERDAY),
    tx("dividend", 35.5, 1, TODAY, 0.5),
    tx("sell", 2, 120, TODAY, 1),
  ];
  const day = realizedOnDay("stock", ledger, TODAY);
  assert.equal(day.income, 35);
  assert.equal(day.trades, 39); // 2 × (120 − 100) − 1 fee
  assert.equal(day.total, 74);
  assert.equal(day.count, 2);
});

test("average cost is taken as of the sell, not from today's buys", () => {
  const ledger: DatedTx[] = [
    tx("buy", 10, 100, "2026-01-05"),
    tx("buy", 10, 200, "2026-06-05"),
    tx("sell", 10, 150, TODAY), // average cost was 150 → break even
  ];
  assert.equal(realizedOnDay("stock", ledger, TODAY).total, 0);
});

test("cash income and fees land in today's number too", () => {
  const ledger: DatedTx[] = [
    tx("deposit", 1000, 1, "2026-02-01", 2),
    tx("dividend", 12, 1, TODAY),
    tx("withdraw", 100, 1, TODAY, 1.5),
  ];
  const day = realizedOnDay("cash", ledger, TODAY);
  assert.equal(day.income, 12);
  assert.equal(day.trades, -1.5);
  assert.equal(day.total, 10.5);
});

test("float noise from averaged costs is not shown as a gain", () => {
  const ledger: DatedTx[] = [
    tx("buy", 3, 0.1, "2026-01-05"),
    tx("buy", 3, 0.2, "2026-02-05"),
    tx("sell", 3, 0.15, TODAY),
  ];
  assert.equal(realizedOnDay("crypto", ledger, TODAY).total, 0);
});

test("per-asset results add up to one portfolio number", () => {
  const aapl = realizedOnDay("stock", [tx("buy", 1, 100, "2026-01-01"), tx("sell", 1, 130, TODAY)], TODAY);
  const btc = realizedOnDay("crypto", [tx("buy", 1, 1000, "2026-01-01"), tx("sell", 1, 900, TODAY)], TODAY);
  const usd = realizedOnDay("cash", [tx("dividend", 5, 1, TODAY)], TODAY);

  const total = sumDayRealized([aapl, btc, usd]);
  assert.equal(total.total, -65); // +30 − 100 + 5
  assert.equal(total.income, 5);
  assert.equal(total.trades, -70);
  assert.equal(total.count, 3);
  assert.deepEqual(sumDayRealized([]), { total: 0, trades: 0, income: 0, count: 0 });
});

test("dated transactions group by asset for the per-asset replay", () => {
  const rows = [
    { assetId: 2, ...tx("buy", 1, 10, "2026-01-01") },
    { assetId: 1, ...tx("buy", 2, 10, "2026-01-02") },
    { assetId: 2, ...tx("sell", 1, 12, TODAY) },
  ];
  const grouped = groupTxsByAsset(rows);
  assert.deepEqual([...grouped.keys()], [2, 1]);
  assert.equal(grouped.get(2)?.length, 2);
  assert.equal(grouped.get(1)?.length, 1);
});

test("the reset time is the user's 12am in the configured timezone", () => {
  // 23:59 and 00:00 in Phnom Penh (UTC+7, no DST).
  assert.equal(dayKeyInTimeZone(new Date("2026-10-28T16:59:00Z"), "Asia/Phnom_Penh"), "2026-10-28");
  assert.equal(dayKeyInTimeZone(new Date("2026-10-28T17:00:00Z"), "Asia/Phnom_Penh"), "2026-10-29");
  assert.equal(dayKeyInTimeZone(new Date("2026-10-28T16:59:00Z"), "UTC"), "2026-10-28");
  assert.equal(dayKeyInTimeZone(new Date("2026-10-28T00:00:00Z"), "UTC"), "2026-10-28");
  // A blank or bogus zone falls back to the server zone instead of throwing.
  assert.equal(dayKeyInTimeZone(new Date("2026-10-28T16:59:00Z"), "").length, 10);
  assert.equal(dayKeyInTimeZone(new Date("2026-10-28T16:59:00Z"), "Mars/Olympus").length, 10);
});
