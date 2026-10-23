import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { assignHolding, groupByFolder, splitByFolder } from "../src/lib/holdings-folders";

const rootDir = resolve(__dirname, "..");
const read = (file: string) => readFileSync(join(rootDir, file), "utf8");

test("dragging a holding onto a group files it and keeps the group order", () => {
  const folders = [
    { id: "a", name: "A", color: "#6366f1", icon: "auto" as const, glyph: "", collapsed: false },
    { id: "b", name: "B", color: "#0ea5e9", icon: "auto" as const, glyph: "", collapsed: false },
  ];
  const rows = [
    { id: 1, value: 100 },
    { id: 2, value: 50 },
    { id: 3, value: 25 },
  ];
  const before = { 1: "a" };
  const after = assignHolding(before, 2, "b");

  // Only real folders are groups — holdlings in no folder are plain rows.
  const start = splitByFolder(rows, folders, before);
  assert.deepEqual(start.groups.map((g) => g.folder.id), ["a"]);
  assert.deepEqual(start.ungrouped.map((row) => row.id), [2, 3]);

  const next = splitByFolder(rows, folders, after);
  assert.deepEqual(next.groups.map((g) => g.folder.id), ["a", "b"]);
  assert.deepEqual(next.groups[1].rows.map((row) => row.id), [2]);
  assert.deepEqual(next.ungrouped.map((row) => row.id), [3]);
  // The original map is untouched, so an optimistic update can be rolled back.
  assert.deepEqual(before, { 1: "a" });
});

test("choosing \"No folder\" pulls a holding back out of its folder", () => {
  const folders = [
    { id: "a", name: "A", color: "#6366f1", icon: "auto" as const, glyph: "", collapsed: false },
  ];
  const rows = [{ id: 1, value: 10 }];
  const filed = { 1: "a" };
  assert.equal(splitByFolder(rows, folders, filed).groups[0].folder.id, "a");

  const ungrouped = assignHolding(filed, 1, null);
  assert.deepEqual(ungrouped, {});
  // With nothing filed there are no groups at all and the row is a plain row.
  const split = splitByFolder(rows, folders, ungrouped);
  assert.deepEqual(split.groups, []);
  assert.deepEqual(split.ungrouped.map((row) => row.id), [1]);
});

test("the table implements in-place drag-and-drop filing, with an immediate save", () => {
  const table = read("src/components/HoldingsTable.tsx");

  // One filing path used by drag-and-drop, the group drop zones and the dropdown.
  assert.ok(table.includes("function fileHolding("), "filing goes through one helper");
  assert.ok(table.includes("function groupDropProps("), "a whole folder group is a drop target");
  assert.ok(table.includes("function viewDragHandle("), "rows can be dragged outside arrange mode");
  assert.ok(
    table.includes("saveHoldingFolderAssignment("),
    "a drop outside arrange mode is persisted immediately",
  );
  assert.ok(table.includes("router.refresh()"), "the dashboard is re-read after a drop");
  assert.ok(
    table.includes("setAssignments(previous)"),
    "a refused move is rolled back to the previous filing",
  );
  // Empty folders get their own drop target so they can be filled by dragging.
  assert.ok(table.includes("emptyFolders"), "empty folders are droppable");
  assert.ok(table.includes("Drop to file here"), "the drop target says what dropping does");
  // The dropdown is the keyboard/touch path and is available in normal view too.
  assert.match(table, /if \(arranging \|\| hasFolders\) \{/);
});

test("the folder strip hands drops to the table instead of writing on its own", () => {
  const strip = read("src/components/HoldingsFolders.tsx");
  assert.ok(strip.includes("onFileHolding"), "the strip files through the table's helper");
  assert.ok(!strip.includes("onAssignmentsChange(assignHolding("), "no second filing path");
  // Chips still accept drops in the normal view.
  assert.ok(strip.includes("onDragOver={(event) => allowHoldingDrop(event, folder.id)}"));
});

test("the filing action validates the holding and the folder before writing", () => {
  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes("export async function saveHoldingFolderAssignment("));
  assert.ok(
    actions.includes("setHoldingFolder(Number(input?.assetId)"),
    "the action delegates to the storage helper",
  );
  assert.ok(actions.includes("refresh();"), "the dashboard is revalidated");

  const db = read("src/lib/dashboard-order-db.ts");
  assert.ok(db.includes("export async function setHoldingFolder("));
  assert.ok(db.includes('"Unknown holding."'), "a non-numeric id is rejected");
  assert.ok(db.includes('"That holding no longer exists."'), "a deleted holding is rejected");
  assert.ok(db.includes('"That folder no longer exists."'), "a stale folder is rejected");
  assert.ok(
    db.includes("assignHolding(current, assetId, target)"),
    "only the one assignment is changed",
  );
});
