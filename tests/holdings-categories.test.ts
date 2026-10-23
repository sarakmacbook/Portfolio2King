import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_HOLDING_FILTER_ORDER,
  HOLDING_FILTERS,
  HOLDING_FILTER_KEYS,
  isHoldingFilter,
  moveHoldingFilterBy,
  moveHoldingFilterTo,
  normaliseHoldingFilterOrder,
  orderHoldingFilters,
  type HoldingFilter,
} from "../src/lib/holdings-filter";

test("the category keys match the tab list and its default order", () => {
  assert.deepEqual(HOLDING_FILTER_KEYS, [
    "all",
    "cash",
    "stock",
    "stablecoin",
    "volatile",
    "other",
  ]);
  assert.deepEqual(
    DEFAULT_HOLDING_FILTER_ORDER,
    HOLDING_FILTERS.map((item) => item.value),
  );
  assert.ok(isHoldingFilter("stablecoin"));
  // "crypto" is an asset type, not a tab: the two crypto buckets are separate.
  assert.equal(isHoldingFilter("crypto"), false);
  assert.equal(isHoldingFilter(7), false);
  assert.equal(isHoldingFilter(undefined), false);
});

test("normaliseHoldingFilterOrder always returns every category exactly once", () => {
  assert.deepEqual(normaliseHoldingFilterOrder(undefined), DEFAULT_HOLDING_FILTER_ORDER);
  assert.deepEqual(normaliseHoldingFilterOrder(""), DEFAULT_HOLDING_FILTER_ORDER);
  assert.deepEqual(normaliseHoldingFilterOrder(42), DEFAULT_HOLDING_FILTER_ORDER);
  // Whatever is stored, the tabs that are missing keep their default relative spot.
  assert.deepEqual(normaliseHoldingFilterOrder("volatile,cash"), [
    "volatile",
    "cash",
    "all",
    "stock",
    "stablecoin",
    "other",
  ]);
  assert.deepEqual(normaliseHoldingFilterOrder(["other", "other", "nope"]), [
    "other",
    "all",
    "cash",
    "stock",
    "stablecoin",
    "volatile",
  ]);
  assert.deepEqual(normaliseHoldingFilterOrder('["stock","all"]'), [
    "stock",
    "all",
    "cash",
    "stablecoin",
    "volatile",
    "other",
  ]);
});

test("a category can be nudged left and right, clamped at both ends", () => {
  const order = DEFAULT_HOLDING_FILTER_ORDER;
  assert.deepEqual(moveHoldingFilterBy(order, "cash", -1), [
    "cash",
    "all",
    "stock",
    "stablecoin",
    "volatile",
    "other",
  ]);
  assert.deepEqual(moveHoldingFilterBy(order, "stock", 1), [
    "all",
    "cash",
    "stablecoin",
    "stock",
    "volatile",
    "other",
  ]);
  // Already first / already last: nothing moves.
  assert.deepEqual(moveHoldingFilterBy(order, "all", -1), order);
  assert.deepEqual(moveHoldingFilterBy(order, "other", 1), order);
  // A big delta clamps instead of dropping the key.
  assert.deepEqual(moveHoldingFilterBy(order, "other", -99), [
    "other",
    "all",
    "cash",
    "stock",
    "stablecoin",
    "volatile",
  ]);
  // The stored order is never mutated in place.
  assert.deepEqual(order, DEFAULT_HOLDING_FILTER_ORDER);
});

test("a dragged category lands before or after the one it was dropped on", () => {
  const order = DEFAULT_HOLDING_FILTER_ORDER;
  assert.deepEqual(moveHoldingFilterTo(order, "all", "other", true), [
    "cash",
    "stock",
    "stablecoin",
    "volatile",
    "other",
    "all",
  ]);
  assert.deepEqual(moveHoldingFilterTo(order, "other", "cash", false), [
    "all",
    "other",
    "cash",
    "stock",
    "stablecoin",
    "volatile",
  ]);
  // Dropping a tab on itself, or an unknown key, changes nothing.
  assert.deepEqual(moveHoldingFilterTo(order, "cash", "cash", true), order);
  assert.deepEqual(moveHoldingFilterTo(order, "nope" as HoldingFilter, "cash", false), order);
});

test("orderHoldingFilters returns the tabs with their labels in the saved order", () => {
  assert.deepEqual(orderHoldingFilters(["volatile", "all"]), [
    { value: "volatile", label: "Volatile crypto" },
    { value: "all", label: "All" },
    { value: "cash", label: "Cash" },
    { value: "stock", label: "Stocks" },
    { value: "stablecoin", label: "Stablecoins" },
    { value: "other", label: "Other" },
  ]);
  // An empty or stale setting still renders every tab exactly once.
  assert.deepEqual(orderHoldingFilters([]), HOLDING_FILTERS);
  assert.deepEqual(orderHoldingFilters(["bogus" as HoldingFilter]), HOLDING_FILTERS);
});

test("the arranged order is saved and reset with the rest of the dashboard layout", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");

  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes('"holdingCategories"'), "save action reads the holdingCategories field");
  assert.ok(actions.includes("saveHoldingsCategoryOrder("), "save action stores the category order");
  assert.ok(actions.includes("clearHoldingsCategoryOrder("), "reset action clears the category order");

  const layout = read("src/components/DashboardLayout.tsx");
  assert.ok(layout.includes("HoldingsArrangeProvider"), "layout shares the pending order with the table");
  assert.ok(layout.includes('fd.set("holdingCategories"'), "layout sends the pending order when saving");

  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(table.includes("useHoldingsArrange()"), "table arranges its tabs inside the dashboard mode");
  assert.ok(table.includes("orderHoldingFilters("), "table renders the tabs in the arranged order");
});
