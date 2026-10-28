import { test } from "node:test";
import assert from "node:assert/strict";
import { cryptoUnrealizedChange, openingCryptoUnrealized, type DailyCryptoHolding } from "../src/lib/daily-crypto";
import { realizedOnDay } from "../src/lib/daily-realized";
import type { DatedTx } from "../src/lib/daily-realized";

const day = "2026-06-02";
const before: DatedTx = { kind: "buy", quantity: 2, price: 100, date: "2026-06-01" };
const snap = [{ date: "2026-06-01", price: 120 }, { date: day, price: 150 }];
const holding = (overrides: Partial<DailyCryptoHolding> = {}): DailyCryptoHolding => ({
  id: 1, symbol: "BTC", provider: "", quantity: 2, avgCost: 100, price: 130,
  openingUnrealized: 40, ...overrides,
});

test("opening uses latest valid prior snapshot, not today's overwritten snapshot", () => {
  assert.equal(openingCryptoUnrealized([before], snap, day), 40);
  assert.equal(openingCryptoUnrealized([before], [{ date: "2026-05-30", price: 90 }, ...snap], day), 40);
  assert.equal(openingCryptoUnrealized([before], [{ date: day, price: 150 }], day), null);
  assert.equal(openingCryptoUnrealized([], [], day), 0);
});

test("live crypto movement changes the combined total without changing the baseline", () => {
  assert.equal(cryptoUnrealizedChange([holding()]), 20);
  assert.equal(cryptoUnrealizedChange([holding()], { 1: 140 }), 40);
  assert.equal(cryptoUnrealizedChange([holding({ openingUnrealized: null })]), 0);
  assert.equal(cryptoUnrealizedChange([holding({ price: 0 })]), 0);
});

test("a sale's booked P/L and open P/L change do not double count old gains", () => {
  const sale: DatedTx = { kind: "sell", quantity: 1, price: 130, date: day };
  const booked = realizedOnDay("crypto", [before, sale], day).total;
  const change = cryptoUnrealizedChange([holding({ quantity: 1, price: 140 })]);
  assert.equal(booked + change, 30); // 10 on the sold coin, 20 on the retained coin since the snapshot
});

test("a position bought today contributes only its gain after purchase", () => {
  const buy: DatedTx = { kind: "buy", quantity: 1, price: 125, date: day };
  const opening = openingCryptoUnrealized([buy], [], day);
  assert.equal(cryptoUnrealizedChange([holding({ quantity: 1, avgCost: 125, openingUnrealized: opening, price: 140 })]), 15);
});
