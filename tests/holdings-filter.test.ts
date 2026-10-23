import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOLDING_FILTERS,
  categoryFilterLabel,
  categoryTotalValue,
  filterHoldingsByCategory,
  getSelectedHoldingFilter,
  setSelectedHoldingFilter,
  subscribeHoldingFilter,
  type FilterableHolding,
} from "../src/lib/holdings-filter";

const sampleRows: FilterableHolding[] = [
  { type: "cash", cryptoCategory: "volatile", value: 1200, cost: 1200 },
  { type: "stock", cryptoCategory: "volatile", value: 3500, cost: 3000 },
  { type: "crypto", cryptoCategory: "stablecoin", value: 800, cost: 800 },
  { type: "crypto", cryptoCategory: "volatile", value: 2500, cost: 2000 },
  { type: "other", cryptoCategory: "volatile", value: 450, cost: 400 },
];

test("categoryTotalValue and filterHoldingsByCategory compute total $ for each category", () => {
  assert.equal(categoryTotalValue(sampleRows, "all"), 8450);
  assert.equal(categoryTotalValue(sampleRows, "cash"), 1200);
  assert.equal(categoryTotalValue(sampleRows, "stock"), 3500);
  assert.equal(categoryTotalValue(sampleRows, "stablecoin"), 800);
  assert.equal(categoryTotalValue(sampleRows, "volatile"), 2500);
  assert.equal(categoryTotalValue(sampleRows, "other"), 450);

  assert.equal(filterHoldingsByCategory(sampleRows, "all").length, 5);
  assert.equal(filterHoldingsByCategory(sampleRows, "stablecoin").length, 1);
  assert.equal(filterHoldingsByCategory(sampleRows, "volatile").length, 1);
  assert.equal(categoryFilterLabel("other"), "Other");
  assert.equal(HOLDING_FILTERS.length, 6);
});

test("holding filter store notifies subscribers and updates selected category", () => {
  const seen: string[] = [];
  const unsubscribe = subscribeHoldingFilter(() => {
    seen.push(getSelectedHoldingFilter());
  });
  try {
    setSelectedHoldingFilter("other");
    assert.equal(getSelectedHoldingFilter(), "other");
    setSelectedHoldingFilter("cash");
    assert.equal(getSelectedHoldingFilter(), "cash");
    setSelectedHoldingFilter("all");
    assert.equal(getSelectedHoldingFilter(), "all");
    assert.deepEqual(seen, ["other", "cash", "all"]);
  } finally {
    unsubscribe();
    setSelectedHoldingFilter("all");
  }
});
