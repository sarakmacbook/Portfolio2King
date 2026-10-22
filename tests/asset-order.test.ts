import assert from "node:assert/strict";
import { test } from "node:test";
import { dropIndexFor, mergeOrder, moveId, moveItem, nextSortOrder } from "../src/lib/asset-order";

const ids = [10, 20, 30, 40];

test("moveItem moves rows and clamps out-of-range indexes", () => {
  assert.deepEqual(moveItem(ids, 0, 2), [20, 30, 10, 40]);
  assert.deepEqual(moveItem(ids, 3, 0), [40, 10, 20, 30]);
  assert.deepEqual(moveItem(ids, 1, 1), ids);
  assert.deepEqual(moveItem(ids, 0, 99), [20, 30, 40, 10]);
  assert.deepEqual(moveItem(ids, -1, 2), ids);
  assert.deepEqual(moveItem(ids, 9, 2), ids);
  assert.deepEqual(moveItem(ids, 0, 1.5), ids);
  // The input is never mutated.
  assert.deepEqual(ids, [10, 20, 30, 40]);
});

test("dropIndexFor accounts for the removal shift when dragging forward", () => {
  // Drag 10 (index 0) onto the lower half of 30 (index 2): it should land after 30.
  assert.equal(dropIndexFor(ids, 10, 30, true), 2);
  // Lower half of 20 → between 20 and 30.
  assert.equal(dropIndexFor(ids, 10, 20, true), 1);
  // Upper half of 20 → stays at the top.
  assert.equal(dropIndexFor(ids, 10, 20, false), 0);
  // Dragging backwards needs no shift.
  assert.equal(dropIndexFor(ids, 40, 20, false), 1);
  assert.equal(dropIndexFor(ids, 40, 10, false), 0);
  // Unknown ids are ignored.
  assert.equal(dropIndexFor(ids, 999, 20, false), -1);
  assert.equal(dropIndexFor(ids, 10, 999, false), -1);
});

test("moveId applies a drop", () => {
  assert.deepEqual(moveId(ids, 10, 30, true), [20, 30, 10, 40]);
  assert.deepEqual(moveId(ids, 10, 40, true), [20, 30, 40, 10]);
  assert.deepEqual(moveId(ids, 40, 10, false), [40, 10, 20, 30]);
  assert.deepEqual(moveId(ids, 20, 20, false), ids);
  assert.deepEqual(moveId(ids, 999, 10, false), ids);
});

test("mergeOrder keeps the submitted sequence and appends unknown rows", () => {
  // Normal case.
  assert.deepEqual(mergeOrder([30, 10, 20, 40], ids), [30, 10, 20, 40]);
  // Stale tab: omits 40, includes a deleted id 99, duplicates 10.
  assert.deepEqual(mergeOrder([30, 99, 10, 10], ids), [30, 10, 20, 40]);
  // Newly added asset is appended at the end.
  assert.deepEqual(mergeOrder([20, 10], ids), [20, 10, 30, 40]);
  // Completely empty submission falls back to the existing order.
  assert.deepEqual(mergeOrder([], ids), ids);
  assert.deepEqual(mergeOrder([0, -1, 1.5], ids), ids);
});

test("nextSortOrder places new assets after the last positioned row", () => {
  assert.equal(nextSortOrder([]), 0);
  assert.equal(nextSortOrder([{ id: 1, sortOrder: null }]), 0);
  assert.equal(nextSortOrder([{ id: 1, sortOrder: 4 }, { id: 2, sortOrder: null }]), 5);
  assert.equal(nextSortOrder([{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 7 }]), 8);
});
