import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  applyHoldingOrder,
  hasHoldingOrder,
  moveHoldingBy,
  moveHoldingTo,
  normaliseHoldingOrder,
  parseHoldingOrderIds,
} from "../src/lib/holdings-order";

test("parseHoldingOrderIds reads a comma string, a JSON array or an array", () => {
  assert.deepEqual(parseHoldingOrderIds("4,2,9"), [4, 2, 9]);
  assert.deepEqual(parseHoldingOrderIds(" 4, 2 ,9 "), [4, 2, 9]);
  assert.deepEqual(parseHoldingOrderIds("[7,3]"), [7, 3]);
  assert.deepEqual(parseHoldingOrderIds([7, 3]), [7, 3]);
  assert.deepEqual(parseHoldingOrderIds(["7", "3"]), [7, 3]);
  // Junk never reaches the page: duplicates, zeros, negatives and text are dropped.
  assert.deepEqual(parseHoldingOrderIds("3,3,0,-2,abc,4"), [3, 4]);
  assert.deepEqual(parseHoldingOrderIds(undefined), []);
  assert.deepEqual(parseHoldingOrderIds(""), []);
  assert.deepEqual(parseHoldingOrderIds("{bad json"), []);
  assert.deepEqual(parseHoldingOrderIds({ nope: true }), []);
  assert.equal(hasHoldingOrder(""), false);
  assert.equal(hasHoldingOrder("1,2"), true);
});

test("normaliseHoldingOrder keeps every current holding exactly once", () => {
  const ids = [10, 11, 12, 13];
  // A stale id is dropped and the holdings it does not mention keep their spot.
  assert.deepEqual(normaliseHoldingOrder("13,999,10", ids), [13, 10, 11, 12]);
  assert.deepEqual(normaliseHoldingOrder(undefined, ids), ids);
  assert.deepEqual(normaliseHoldingOrder("10,10,11", ids), [10, 11, 12, 13]);
  // A holding added after the arrangement was saved lands at the bottom.
  assert.deepEqual(normaliseHoldingOrder("12,10", [10, 11, 12, 13, 14]), [12, 10, 11, 13, 14]);
  // Nothing is invented when the portfolio is empty.
  assert.deepEqual(normaliseHoldingOrder("1,2,3", []), []);
});

test("a holding can be nudged up and down, clamped at both ends", () => {
  const order = [1, 2, 3, 4];
  assert.deepEqual(moveHoldingBy(order, 2, -1), [2, 1, 3, 4]);
  assert.deepEqual(moveHoldingBy(order, 3, 1), [1, 2, 4, 3]);
  assert.deepEqual(moveHoldingBy(order, 1, -1), order);
  assert.deepEqual(moveHoldingBy(order, 4, 1), order);
  assert.deepEqual(moveHoldingBy(order, 4, -99), [4, 1, 2, 3]);
  assert.deepEqual(moveHoldingBy(order, 99, 1), order);
  // The stored order is never mutated in place.
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test("a dragged holding lands before or after the one it was dropped on", () => {
  const order = [1, 2, 3, 4];
  assert.deepEqual(moveHoldingTo(order, 1, 4, true), [2, 3, 4, 1]);
  assert.deepEqual(moveHoldingTo(order, 4, 2, false), [1, 4, 2, 3]);
  assert.deepEqual(moveHoldingTo(order, 2, 3, true), [1, 3, 2, 4]);
  // Dropping a row on itself, or on an unknown row, changes nothing.
  assert.deepEqual(moveHoldingTo(order, 2, 2, true), order);
  assert.deepEqual(moveHoldingTo(order, 42, 2, false), order);
});

test("applyHoldingOrder re-orders rows without losing any", () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(
    applyHoldingOrder(rows, [3, 1, 2]).map((row) => row.id),
    [3, 1, 2],
  );
  // Rows the order never mentions keep their relative position at the end.
  assert.deepEqual(
    applyHoldingOrder(rows, [3]).map((row) => row.id),
    [3, 1, 2],
  );
  // No arrangement = the rows as they arrived.
  assert.deepEqual(
    applyHoldingOrder(rows, []).map((row) => row.id),
    [1, 2, 3],
  );
  // A filtered view keeps the arranged order of whatever is left.
  assert.deepEqual(
    applyHoldingOrder([{ id: 1 }, { id: 3 }], [3, 2, 1]).map((row) => row.id),
    [3, 1],
  );
  // The input array is not mutated.
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3]);
});

test("the arrangement is saved and reset with the rest of the dashboard layout", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");

  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes('"holdingOrder"'), "the save action reads the holdingOrder field");
  assert.ok(actions.includes("saveHoldingsOrder("), "the save action stores the holding order");
  assert.ok(actions.includes("clearHoldingsOrder("), "the reset action clears the holding order");

  const db = read("src/lib/dashboard-order-db.ts");
  assert.ok(db.includes('"holdings.order"'), "the order lives under holdings.order");
  assert.ok(db.includes("saveHoldingsOrder"), "the setting is written through saveHoldingsOrder");

  const layout = read("src/components/DashboardLayout.tsx");
  assert.ok(layout.includes("initialAssetOrder"), "the layout receives the saved holding order");
  assert.ok(layout.includes('fd.set("holdingOrder"'), "the layout sends the pending order when saving");
  assert.ok(layout.includes("onAssetOrderChange"), "the layout shares the pending order with the table");

  const page = read("src/app/page.tsx");
  assert.ok(page.includes("loadHoldingsOrder("), "the dashboard loads the saved holding order");
  assert.ok(page.includes("initialAssetOrder={holdingOrder}"), "the dashboard passes it to the layout");

  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(table.includes("useHoldingsArrange()"), "the table arranges its rows inside the dashboard mode");
  assert.ok(table.includes("applyHoldingOrder("), "the table renders the rows in the arranged order");
  assert.ok(table.includes("moveHoldingTo("), "a holding can be dragged to a new place");
  assert.ok(table.includes("moveHoldingBy("), "a holding can be nudged with the arrows");
  assert.ok(table.includes("holdingArrangeControls("), "desktop and mobile rows share the same controls");
});
