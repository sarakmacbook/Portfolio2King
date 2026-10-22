import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_GROUP_ORDER,
  flattenSections,
  groupKeyFor,
  groupSections,
  moveGroupBy,
  moveGroupTo,
  moveRowWithinGroup,
  normaliseGroupOrder,
} from "../src/lib/holdings-groups";

const holdings = [
  { id: 1, type: "cash" as const, cryptoCategory: "volatile" as const, name: "ABA" },
  { id: 2, type: "stock" as const, cryptoCategory: "volatile" as const, name: "AAPL" },
  { id: 3, type: "crypto" as const, cryptoCategory: "stablecoin" as const, name: "USDT" },
  { id: 4, type: "crypto" as const, cryptoCategory: "volatile" as const, name: "BTC" },
  { id: 5, type: "crypto" as const, cryptoCategory: "volatile" as const, name: "ETH" },
  { id: 6, type: "other" as const, cryptoCategory: "volatile" as const, name: "Gold" },
];

test("holdings map to one of the five categories", () => {
  assert.equal(groupKeyFor({ type: "cash", cryptoCategory: "volatile" }), "cash");
  assert.equal(groupKeyFor({ type: "stock", cryptoCategory: "volatile" }), "stock");
  assert.equal(groupKeyFor({ type: "crypto", cryptoCategory: "stablecoin" }), "crypto-stablecoin");
  assert.equal(groupKeyFor({ type: "crypto", cryptoCategory: "volatile" }), "crypto-volatile");
  assert.equal(groupKeyFor({ type: "other", cryptoCategory: "volatile" }), "other");
});

test("normaliseGroupOrder always returns every category exactly once", () => {
  assert.deepEqual(normaliseGroupOrder(undefined), DEFAULT_GROUP_ORDER);
  assert.deepEqual(normaliseGroupOrder(""), DEFAULT_GROUP_ORDER);
  assert.deepEqual(normaliseGroupOrder("other,cash"), ["other", "cash", "stock", "crypto-stablecoin", "crypto-volatile"]);
  assert.deepEqual(normaliseGroupOrder(["stock", "stock", "nope"]), ["stock", "cash", "crypto-stablecoin", "crypto-volatile", "other"]);
  assert.deepEqual(normaliseGroupOrder('["crypto-volatile","cash"]'), [
    "crypto-volatile",
    "cash",
    "stock",
    "crypto-stablecoin",
    "other",
  ]);
  assert.deepEqual(normaliseGroupOrder("{bad json"), DEFAULT_GROUP_ORDER);
});

test("groupSections follows the category order and drops empty sections", () => {
  const sections = groupSections(holdings, ["crypto-volatile", "cash", "stock", "crypto-stablecoin", "other"]);
  assert.deepEqual(sections.map((section) => section.key), ["crypto-volatile", "cash", "stock", "crypto-stablecoin", "other"]);
  assert.deepEqual(sections[0].rows.map((row) => row.name), ["BTC", "ETH"]);
  assert.equal(sections[0].meta.label, "Crypto · Volatile");

  const cashOnly = groupSections([holdings[0]], DEFAULT_GROUP_ORDER);
  assert.deepEqual(cashOnly.map((section) => section.key), ["cash"]);
});

test("groupSections keeps the incoming order inside each category", () => {
  const reordered = [holdings[4], holdings[3], holdings[0]]; // ETH, BTC, ABA
  const sections = groupSections(reordered, DEFAULT_GROUP_ORDER);
  assert.deepEqual(sections.map((section) => section.key), ["cash", "crypto-volatile"]);
  assert.deepEqual(sections[1].rows.map((row) => row.name), ["ETH", "BTC"]);
});

test("flattenSections rebuilds the persisted list group by group", () => {
  const sections = groupSections(holdings, ["other", "cash", "stock", "crypto-stablecoin", "crypto-volatile"]);
  assert.deepEqual(flattenSections(sections).map((row) => row.id), [6, 1, 2, 3, 4, 5]);
});

test("moveGroupBy moves a category up and down, clamped at the ends", () => {
  const start = [...DEFAULT_GROUP_ORDER];
  assert.deepEqual(moveGroupBy(start, "other", -4), ["other", "cash", "stock", "crypto-stablecoin", "crypto-volatile"]);
  assert.deepEqual(moveGroupBy(start, "cash", 99), ["stock", "crypto-stablecoin", "crypto-volatile", "other", "cash"]);
  assert.deepEqual(moveGroupBy(start, "cash", 1), ["stock", "cash", "crypto-stablecoin", "crypto-volatile", "other"]);
  assert.deepEqual(moveGroupBy(start, "cash", -1), start);
  assert.deepEqual(moveGroupBy(start, "missing" as never, 1), start);
});

test("moveGroupTo drops a category before or after another", () => {
  const start = [...DEFAULT_GROUP_ORDER];
  assert.deepEqual(moveGroupTo(start, "other", "cash", false), ["other", "cash", "stock", "crypto-stablecoin", "crypto-volatile"]);
  assert.deepEqual(moveGroupTo(start, "cash", "other", true), ["stock", "crypto-stablecoin", "crypto-volatile", "other", "cash"]);
  assert.deepEqual(moveGroupTo(start, "stock", "stock", true), start);
});

test("moveRowWithinGroup reorders inside a category and preserves other slots", () => {
  const order = [1, 2, 3, 4, 5, 6]; // ABA, AAPL, USDT, BTC, ETH, Gold
  // Move BTC above ETH within volatile crypto.
  assert.deepEqual(moveRowWithinGroup(order, holdings, 4, 5, true), [1, 2, 3, 5, 4, 6]);
  // Move ETH above BTC.
  assert.deepEqual(moveRowWithinGroup(order, holdings, 5, 4, false), [1, 2, 3, 5, 4, 6]);
  // No-op when the drop would not change anything.
  assert.deepEqual(moveRowWithinGroup(order, holdings, 4, 5, false), order);
});

test("moveRowWithinGroup refuses to move a holding into another category", () => {
  const order = [1, 2, 3, 4, 5, 6];
  // BTC (crypto) dropped onto AAPL (stock) must not change the order.
  assert.deepEqual(moveRowWithinGroup(order, holdings, 4, 2, true), order);
  assert.deepEqual(moveRowWithinGroup(order, holdings, 1, 3, false), order);
  // Unknown ids are ignored.
  assert.deepEqual(moveRowWithinGroup(order, holdings, 999, 1, false), order);
});
