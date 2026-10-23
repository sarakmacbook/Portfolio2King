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
import {
  DASHBOARD_STATS,
  DEFAULT_DASHBOARD_STAT_LABELS,
  DEFAULT_DASHBOARD_STAT_ORDER,
  isDashboardStatKey,
  MAX_DASHBOARD_STAT_LABEL_LENGTH,
  moveStatBy,
  moveStatTo,
  normaliseDashboardStatLabels,
  normaliseDashboardStatOrder,
} from "../src/lib/dashboard-stats";

test("dashboard blocks and metadata are complete", () => {
  assert.deepEqual(DEFAULT_DASHBOARD_ORDER, ["stats", "holdings", "history", "allocation", "activity"]);
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
  // An order saved before the stat row became a block keeps the row on top.
  assert.deepEqual(normaliseDashboardOrder("activity,holdings"), [
    "stats",
    "activity",
    "holdings",
    "history",
    "allocation",
  ]);
  assert.deepEqual(normaliseDashboardOrder(["history", "history", "nope"]), [
    "stats",
    "history",
    "holdings",
    "allocation",
    "activity",
  ]);
  assert.deepEqual(normaliseDashboardOrder('["allocation","history"]'), [
    "stats",
    "allocation",
    "history",
    "holdings",
    "activity",
  ]);
  // Once the row has a place, normalisation keeps it there.
  assert.deepEqual(normaliseDashboardOrder("holdings,stats"), [
    "holdings",
    "stats",
    "history",
    "allocation",
    "activity",
  ]);
  assert.deepEqual(normaliseDashboardOrder("{not json"), DEFAULT_DASHBOARD_ORDER);
  assert.deepEqual(normaliseDashboardOrder(42), DEFAULT_DASHBOARD_ORDER);
});

test("moveBlockBy moves a card up and down, clamped at the ends", () => {
  const start = [...DEFAULT_DASHBOARD_ORDER];
  assert.deepEqual(moveBlockBy(start, "activity", -3), ["stats", "activity", "holdings", "history", "allocation"]);
  assert.deepEqual(moveBlockBy(start, "holdings", 99), ["stats", "history", "allocation", "activity", "holdings"]);
  assert.deepEqual(moveBlockBy(start, "holdings", 1), ["stats", "history", "holdings", "allocation", "activity"]);
  assert.deepEqual(moveBlockBy(start, "holdings", -1), ["holdings", "stats", "history", "allocation", "activity"]);
  assert.deepEqual(moveBlockBy(start, "stats", -1), start);
  assert.deepEqual(moveBlockBy(start, "missing" as never, 1), start);
});

test("moveBlockTo drops a card before or after another", () => {
  const start = [...DEFAULT_DASHBOARD_ORDER];
  assert.deepEqual(moveBlockTo(start, "activity", "holdings", false), [
    "stats",
    "activity",
    "holdings",
    "history",
    "allocation",
  ]);
  assert.deepEqual(moveBlockTo(start, "holdings", "activity", true), [
    "stats",
    "history",
    "allocation",
    "activity",
    "holdings",
  ]);
  assert.deepEqual(moveBlockTo(start, "history", "history", true), start);
});

test("the four stat cards have their own left-to-right order", () => {
  assert.deepEqual(DEFAULT_DASHBOARD_STAT_ORDER, ["cash", "invested", "unrealized", "realized"]);
  for (const key of DEFAULT_DASHBOARD_STAT_ORDER) {
    assert.ok(DASHBOARD_STATS[key].label.length > 0, `${key} has a label`);
    assert.ok(isDashboardStatKey(key));
  }
  assert.equal(isDashboardStatKey("stats"), false);
  assert.equal(isDashboardStatKey(3), false);

  // Unknown keys out, duplicates out, missing cards appended in default order.
  assert.deepEqual(normaliseDashboardStatOrder("realized,cash"), ["realized", "cash", "invested", "unrealized"]);
  assert.deepEqual(normaliseDashboardStatOrder(["unrealized", "unrealized", "nope"]), [
    "unrealized",
    "cash",
    "invested",
    "realized",
  ]);
  assert.deepEqual(normaliseDashboardStatOrder(undefined), DEFAULT_DASHBOARD_STAT_ORDER);

  // Arrows and drag both stay inside the row.
  const start = [...DEFAULT_DASHBOARD_STAT_ORDER];
  assert.deepEqual(moveStatBy(start, "realized", -2), ["cash", "realized", "invested", "unrealized"]);
  assert.deepEqual(moveStatBy(start, "cash", -1), start);
  assert.deepEqual(moveStatBy(start, "realized", 1), start);
  assert.deepEqual(moveStatTo(start, "realized", "cash", false), ["realized", "cash", "invested", "unrealized"]);
  assert.deepEqual(moveStatTo(start, "cash", "unrealized", true), ["invested", "unrealized", "cash", "realized"]);
  assert.deepEqual(moveStatTo(start, "cash", "cash", true), start);
});

test("the four stat cards can be renamed and blank names fall back to defaults", () => {
  assert.deepEqual(DEFAULT_DASHBOARD_STAT_LABELS, {
    cash: "Cash",
    invested: "Invested (cost basis)",
    unrealized: "Unrealized P/L",
    realized: "Realized P/L + income",
  });
  assert.deepEqual(normaliseDashboardStatLabels(undefined), DEFAULT_DASHBOARD_STAT_LABELS);
  assert.deepEqual(normaliseDashboardStatLabels(""), DEFAULT_DASHBOARD_STAT_LABELS);
  assert.deepEqual(normaliseDashboardStatLabels("{not json"), DEFAULT_DASHBOARD_STAT_LABELS);
  assert.deepEqual(normaliseDashboardStatLabels(["array"]), DEFAULT_DASHBOARD_STAT_LABELS);

  // Custom labels are trimmed; blank or missing entries fall back to defaults; unknown keys are ignored.
  assert.deepEqual(
    normaliseDashboardStatLabels(
      JSON.stringify({
        cash: "  Dry powder  ",
        invested: "   ",
        unrealized: "Open gain",
        extra: "ignored",
      }),
    ),
    {
      cash: "Dry powder",
      invested: "Invested (cost basis)",
      unrealized: "Open gain",
      realized: "Realized P/L + income",
    },
  );

  // Overlong labels are clipped to MAX_DASHBOARD_STAT_LABEL_LENGTH.
  const long = "x".repeat(MAX_DASHBOARD_STAT_LABEL_LENGTH + 20);
  const clipped = normaliseDashboardStatLabels({ cash: long });
  assert.equal(clipped.cash.length, MAX_DASHBOARD_STAT_LABEL_LENGTH);
});

test("navigation links map to the right sections", async () => {
  const { NAV_LINKS, isActivePath } = await import("../src/lib/nav-links");

  assert.equal(NAV_LINKS.length, 6);
  assert.deepEqual(
    NAV_LINKS.map((link) => link.label),
    ["Dashboard", "Exchanges", "Refresh prices", "Activity", "Alerts", "Database"],
  );
  assert.deepEqual(
    NAV_LINKS.map((link) => link.href),
    ["/", "/exchanges", "/prices", "/activity", "/alerts", "/database"],
  );

  assert.equal(isActivePath("/", "/"), true);
  assert.equal(isActivePath("/assets/12", "/"), true);
  assert.equal(isActivePath("/prices", "/prices"), true);
  assert.equal(isActivePath("/prices/", "/prices"), true);
  assert.equal(isActivePath("/alerts", "/prices"), false);
  // A prefix that is not a section boundary must not light up.
  assert.equal(isActivePath("/prices-archive", "/prices"), false);
  assert.equal(isActivePath("/alerts", "/"), false);
  assert.equal(isActivePath("/exchanges", "/exchanges"), true);
  assert.equal(isActivePath("/exchanges/binance", "/exchanges"), true);
  assert.equal(isActivePath("/prices", "/exchanges"), false);
});
