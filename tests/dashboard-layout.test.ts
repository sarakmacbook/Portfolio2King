import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DASHBOARD_BLOCKS,
  DEFAULT_DASHBOARD_ORDER,
  isDashboardBlockKey,
  moveBlockBy,
  moveBlockTo,
  normaliseDashboardOrder,
} from "../src/lib/dashboard-layout";

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

test("navigation tabs map to the right sections", async () => {
  const { NAV_LINKS, isActivePath } = await import("../src/lib/nav-links");

  assert.equal(NAV_LINKS.length, 5);
  assert.deepEqual(
    NAV_LINKS.map((link) => link.tab),
    ["Home", "Prices", "Activity", "Alerts", "Database"],
  );
  // Short tab labels stay short enough for a phone-width strip.
  for (const link of NAV_LINKS) assert.ok(link.tab.length <= 9, link.tab);
  assert.deepEqual(
    NAV_LINKS.map((link) => link.href),
    ["/", "/prices", "/activity", "/alerts", "/database"],
  );

  assert.equal(isActivePath("/", "/"), true);
  assert.equal(isActivePath("/assets/12", "/"), true);
  assert.equal(isActivePath("/prices", "/prices"), true);
  assert.equal(isActivePath("/prices/", "/prices"), true);
  assert.equal(isActivePath("/alerts", "/prices"), false);
  // A prefix that is not a section boundary must not light up.
  assert.equal(isActivePath("/prices-archive", "/prices"), false);
  assert.equal(isActivePath("/alerts", "/"), false);
});
