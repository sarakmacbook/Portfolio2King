import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DASHBOARD_BLOCKS,
  DEFAULT_DASHBOARD_ORDER,
  allocationSlices,
  isDashboardBlockKey,
  moveBlockBy,
  moveBlockTo,
  normaliseDashboardOrder,
} from "../src/lib/dashboard-layout";
import { DEFAULT_GROUP_ORDER } from "../src/lib/holdings-groups";

test("dashboard blocks and metadata are complete", () => {
  assert.deepEqual(DEFAULT_DASHBOARD_ORDER, ["holdings", "history", "allocation", "activity"]);
  for (const key of DEFAULT_DASHBOARD_ORDER) {
    assert.ok(DASHBOARD_BLOCKS[key].label.length > 0, `${key} has a label`);
    assert.ok(isDashboardBlockKey(key));
  }
  assert.equal(isDashboardBlockKey("settings"), false);
  assert.equal(isDashboardBlockKey(7), false);
});

test("normaliseDashboardOrder always returns every card exactly once", () => {
  assert.deepEqual(normaliseDashboardOrder(undefined), DEFAULT_DASHBOARD_ORDER);
  assert.deepEqual(normaliseDashboardOrder(""), DEFAULT_DASHBOARD_ORDER);
  assert.deepEqual(normaliseDashboardOrder("activity,holdings"), [
    "activity",
    "holdings",
    "history",
    "allocation",
  ]);
  assert.deepEqual(normaliseDashboardOrder(["history", "history", "nope"]), [
    "history",
    "holdings",
    "allocation",
    "activity",
  ]);
  assert.deepEqual(normaliseDashboardOrder('["allocation","history"]'), [
    "allocation",
    "history",
    "holdings",
    "activity",
  ]);
  assert.deepEqual(normaliseDashboardOrder("{not json"), DEFAULT_DASHBOARD_ORDER);
  assert.deepEqual(normaliseDashboardOrder(42), DEFAULT_DASHBOARD_ORDER);
});

test("moveBlockBy moves a card up and down, clamped at the ends", () => {
  const start = [...DEFAULT_DASHBOARD_ORDER];
  assert.deepEqual(moveBlockBy(start, "activity", -3), ["activity", "holdings", "history", "allocation"]);
  assert.deepEqual(moveBlockBy(start, "holdings", 99), ["history", "allocation", "activity", "holdings"]);
  assert.deepEqual(moveBlockBy(start, "holdings", 1), ["history", "holdings", "allocation", "activity"]);
  assert.deepEqual(moveBlockBy(start, "holdings", -1), start);
  assert.deepEqual(moveBlockBy(start, "missing" as never, 1), start);
});

test("moveBlockTo drops a card before or after another", () => {
  const start = [...DEFAULT_DASHBOARD_ORDER];
  assert.deepEqual(moveBlockTo(start, "activity", "holdings", false), [
    "activity",
    "holdings",
    "history",
    "allocation",
  ]);
  assert.deepEqual(moveBlockTo(start, "holdings", "activity", true), [
    "history",
    "allocation",
    "activity",
    "holdings",
  ]);
  assert.deepEqual(moveBlockTo(start, "history", "history", true), start);
});

test("allocationSlices follow the saved category order and drop empty categories", () => {
  const values = {
    cash: 100,
    stock: 250,
    "crypto-stablecoin": 0,
    "crypto-volatile": 400,
    other: 50,
  } as const;
  const slices = allocationSlices(DEFAULT_GROUP_ORDER, { ...values });
  assert.deepEqual(slices.map((slice) => slice.key), ["cash", "stock", "crypto-volatile", "other"]);
  assert.deepEqual(slices.map((slice) => slice.label), ["Cash", "Stocks", "Crypto · Volatile", "Other"]);
  assert.equal(slices[0].value, 100);
  assert.ok(slices.every((slice) => slice.value > 0 && slice.color.length > 0));

  const reversed = allocationSlices(["other", "cash", "stock", "crypto-stablecoin", "crypto-volatile"], { ...values });
  assert.deepEqual(reversed.map((slice) => slice.key), ["other", "cash", "stock", "crypto-volatile"]);

  // A partial stored order is completed with the missing categories in their
  // default spots; the requested category still leads.
  const withStable = allocationSlices(["crypto-stablecoin"], { ...values, "crypto-stablecoin": 25 });
  assert.equal(withStable[0].key, "crypto-stablecoin");
  assert.equal(withStable[0].value, 25);
  assert.deepEqual(allocationSlices(["crypto-stablecoin"], { ...values }).map((slice) => slice.key), [
    "cash",
    "stock",
    "crypto-volatile",
    "other",
  ]);
});

test("allocationSlices tolerate missing values and invalid keys", () => {
  const slices = allocationSlices(["nope" as never, "cash"], {
    cash: 10,
    stock: 0,
    "crypto-stablecoin": 0,
    "crypto-volatile": 0,
    other: 0,
  });
  assert.deepEqual(slices.map((slice) => slice.key), ["cash"]);
  assert.equal(slices[0].value, 10);
});
