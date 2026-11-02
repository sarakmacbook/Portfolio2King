import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  UNGROUPED_SECTION_KEY,
  assetIdFromSectionKey,
  assetSectionKey,
  isAssetSectionKey,
} from "../src/lib/holdings-folders";
import {
  collapseHoldingsSections,
  expandHoldingsSections,
  normaliseHoldingsSections,
  reorderHoldingsAssetSections,
} from "../src/lib/holdings-sections";
import { moveKeyTo } from "../src/lib/order-list";

test("asset section keys are distinct from folder ids and strictly validated", () => {
  const key = assetSectionKey(42);
  assert.equal(key, "$asset:42");
  assert.equal(assetIdFromSectionKey(key), 42);
  assert.equal(isAssetSectionKey(key), true);
  assert.equal(assetIdFromSectionKey("folder"), null);
  assert.equal(assetIdFromSectionKey("$asset:0"), null);
  assert.equal(assetIdFromSectionKey("$asset:-2"), null);
  assert.equal(assetIdFromSectionKey("$asset:nope"), null);
});

test("legacy ungrouped blocks expand in place without dropping new folders", () => {
  const assets = [assetSectionKey(10), assetSectionKey(11)];
  assert.deepEqual(
    normaliseHoldingsSections([UNGROUPED_SECTION_KEY, "a"], ["a", "b"], [10, 11]),
    [...assets, "a", "b"],
  );
  assert.deepEqual(
    normaliseHoldingsSections(["a", UNGROUPED_SECTION_KEY], ["a", "b"], [10, 11]),
    ["a", ...assets, "b"],
  );
});

test("a group keeps its precise place directly below one named asset", () => {
  const kbPrasac = assetSectionKey(42);
  const otherAsset = assetSectionKey(7);
  const before = normaliseHoldingsSections(
    ["asdade", kbPrasac, otherAsset],
    ["asdade"],
    [7, 42],
  );
  const detailed = moveKeyTo(before, "asdade", kbPrasac, true);

  assert.deepEqual(detailed, [kbPrasac, "asdade", otherAsset]);
  assert.equal(detailed.indexOf("asdade"), detailed.indexOf(kbPrasac) + 1);

  const withNewAsset = normaliseHoldingsSections(detailed, ["asdade"], [7, 42, 99]);
  assert.deepEqual(withNewAsset, [kbPrasac, "asdade", otherAsset, assetSectionKey(99)]);
});

test("coarse arrange pills can move the whole ungrouped block", () => {
  const detailed = [assetSectionKey(1), "a", assetSectionKey(2), "b"];
  const blocks = collapseHoldingsSections(detailed);
  assert.deepEqual(blocks, [UNGROUPED_SECTION_KEY, "a", "b"]);
  assert.deepEqual(
    expandHoldingsSections(["a", UNGROUPED_SECTION_KEY, "b"], detailed),
    ["a", assetSectionKey(1), assetSectionKey(2), "b"],
  );
});

test("individual holding arrangement retains group slots and every asset", () => {
  const one = assetSectionKey(1);
  const two = assetSectionKey(2);
  const three = assetSectionKey(3);
  assert.deepEqual(
    reorderHoldingsAssetSections([one, "a", two, three], [3, 1, 2]),
    [three, "a", one, two],
  );
});

test("the table renders precise asset targets and both save paths retain them", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");
  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(table.includes("normaliseHoldingsSections("));
  assert.ok(table.includes("renderDesktopRow(section.row"));
  assert.ok(table.includes("renderMobileCard(section.row"));
  assert.ok(table.includes("moveKeyTo(sectionKeys, key, adjacent.key, true)"));

  for (const file of ["src/app/actions.ts", "src/lib/dashboard-layout-save.ts"]) {
    const source = read(file);
    assert.ok(
      source.includes("known.has(key) || isAssetSectionKey(key)"),
      `${file} keeps detailed asset keys when saving`,
    );
  }
});
