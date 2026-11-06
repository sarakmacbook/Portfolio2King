import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENCY, money, pct, pnlColor, qty } from "../src/lib/format";

test("money formats ordinary amounts in USD", () => {
  assert.equal(CURRENCY, "USD");
  assert.equal(money(0), "$0.00");
  assert.equal(money(1234.5), "$1,234.50");
  assert.equal(money(-1234.5), "-$1,234.50");
  assert.equal(money(1234567.891), "$1,234,567.89");
});

test("money keeps small positive amounts readable instead of rounding to zero", () => {
  assert.equal(money(0.004), "$0.004");
  assert.equal(money(0.000004), "$0.000004");
});

test("money only prefixes a plus sign for real positive amounts", () => {
  assert.equal(money(10, { sign: true }), "+$10.00");
  assert.equal(money(-10, { sign: true }), "-$10.00");
  // A signed zero would read as "+$0.00" and be meaningless.
  assert.equal(money(0, { sign: true }), "$0.00");
});

test("money suppresses negative zero left behind by float arithmetic", () => {
  // quantity * (price - avgCost) - openingUnrealized routinely leaves -1e-13.
  for (const residue of [-1e-12, -1e-9, -1e-7, -0]) {
    assert.equal(money(residue), "$0.00", `${residue} is not a loss`);
    assert.equal(money(residue, { sign: true }), "$0.00", `${residue} gets no sign`);
    assert.equal(pnlColor(residue), "text-slate-500", `${residue} is neutral, not red`);
  }
  // At the rendering boundary the amount is genuinely shown, so it keeps its sign.
  assert.equal(money(-4e-6), "-$0.000004");
});

test("money shows a dash for numbers it cannot format", () => {
  for (const broken of [NaN, Infinity, -Infinity]) {
    assert.equal(money(broken), "—");
    assert.equal(money(broken, { sign: true }), "—");
    assert.equal(money(broken, { compact: true }), "—");
  }
});

test("money compacts only large amounts", () => {
  assert.equal(money(1234567.891, { compact: true }), "$1.23M");
  assert.equal(money(-1234567, { compact: true }), "-$1.23M");
  assert.equal(money(99999, { compact: true }), "$99,999.00");
});

test("qty shows up to eight decimals and never prints garbage", () => {
  assert.equal(qty(1.23456789), "1.23456789");
  assert.equal(qty(1000), "1,000");
  assert.equal(qty(NaN), "—");
  assert.equal(qty(Infinity), "—");
  // Below the smallest shown unit it is zero, not "-0" or "0.0000000001".
  assert.equal(qty(-1e-12), "0");
  assert.equal(qty(1e-12), "0");
});

test("pct guards non-finite input and signed zero alike", () => {
  assert.equal(pct(0.0525), "+5.25%");
  assert.equal(pct(-0.01), "-1.00%");
  assert.equal(pct(0.25, false), "25.00%");
  assert.equal(pct(NaN), "—");
  assert.equal(pct(Infinity), "—");
  assert.equal(pct(-1e-12), "0.00%");
  assert.equal(pct(0), "0.00%");
});

test("pnlColor treats float residue as neutral", () => {
  assert.equal(pnlColor(1), "text-emerald-600");
  assert.equal(pnlColor(-1), "text-rose-600");
  assert.equal(pnlColor(0), "text-slate-500");
  assert.equal(pnlColor(1e-12), "text-slate-500");
  assert.equal(pnlColor(-1e-12), "text-slate-500");
});
