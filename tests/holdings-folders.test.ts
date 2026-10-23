import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  FOLDER_COLORS,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS,
  assignHolding,
  countInFolder,
  groupByFolder,
  makeFolder,
  matchesFolderFilter,
  moveFolderBy,
  moveFolderTo,
  nextFolderId,
  normaliseAssignments,
  normaliseFolders,
  removeFolder,
  updateFolder,
  type HoldingFolder,
} from "../src/lib/holdings-folders";

const folder = (id: string, name = id): HoldingFolder => ({
  id,
  name,
  color: FOLDER_COLORS[0],
  icon: "auto",
  glyph: "",
  collapsed: false,
});

test("normaliseFolders keeps valid folders and clamps everything else", () => {
  assert.deepEqual(normaliseFolders(""), []);
  assert.deepEqual(normaliseFolders("not json"), []);
  assert.deepEqual(normaliseFolders({ nope: 1 }), []);

  const folders = normaliseFolders([
    { id: "long-term", name: "Long term", color: "#22c55e", icon: "emoji", glyph: "🌱" },
    { id: "binance", name: "  Binance  ", color: "not-a-colour", icon: "exchange", glyph: "binance" },
    // Duplicate id, missing name and a bad icon all get handled.
    { id: "long-term", name: "Again" },
    { id: "nameless", name: "   " },
    { id: "weird", name: "Weird", icon: "exchange", glyph: "not-an-exchange" },
    { id: "Bad Id!", name: "Bad" },
  ]);

  assert.deepEqual(folders.map((f) => f.id), ["long-term", "binance", "weird"]);
  assert.equal(folders[0].icon, "emoji");
  assert.equal(folders[0].glyph, "🌱");
  assert.equal(folders[0].color, "#22c55e");
  assert.equal(folders[1].name, "Binance");
  assert.equal(folders[1].icon, "exchange");
  assert.equal(folders[1].glyph, "binance");
  // An unknown colour falls back to the palette instead of storing junk.
  assert.ok(FOLDER_COLORS.includes(folders[1].color as (typeof FOLDER_COLORS)[number]));
  // An exchange icon needs a known exchange, otherwise it becomes a letter.
  assert.equal(folders[2].icon, "auto");
  assert.equal(folders[2].glyph, "");
});

test("normaliseFolders also reads a JSON string and caps the number of folders", () => {
  const stored = JSON.stringify([{ id: "a", name: "A" }]);
  assert.deepEqual(normaliseFolders(stored).map((f) => f.id), ["a"]);

  const many = Array.from({ length: MAX_FOLDERS + 5 }, (_, index) => ({
    id: `f${index}`,
    name: `Folder ${index}`,
  }));
  assert.equal(normaliseFolders(many).length, MAX_FOLDERS);
});

test("normaliseAssignments keeps only known folders and positive asset ids", () => {
  const folders = [folder("a"), folder("b")];
  assert.deepEqual(normaliseAssignments({}, ["a"]), {});
  assert.deepEqual(normaliseAssignments("", ["a"]), {});
  assert.deepEqual(normaliseAssignments("[]", ["a"]), {});
  assert.deepEqual(
    normaliseAssignments({ 12: "a", 13: "gone", 0: "a", "-4": "a", 14: 42 }, ["a", "b"]),
    { 12: "a" },
  );
  assert.deepEqual(normaliseAssignments('{"7":"b"}', ["a", "b"]), { 7: "b" });
  assert.deepEqual(normaliseAssignments({ 7: "b" }, [folders[0].id]), {});
});

test("makeFolder builds a folder with a unique id, colour and clamped name", () => {
  assert.equal(makeFolder({ name: "   " }, []), null);
  const first = makeFolder({ name: "Long term" }, []);
  assert.ok(first);
  assert.equal(first.id, "long-term");
  assert.equal(first.name, "Long term");
  assert.equal(first.icon, "auto");

  const second = makeFolder({ name: "Long term" }, [first]);
  assert.equal(second?.id, "long-term-2");

  const long = makeFolder({ name: "x".repeat(80) }, []);
  assert.equal(long?.name.length, MAX_FOLDER_NAME_LENGTH);

  const exchange = makeFolder({ name: "Binance", icon: "exchange", glyph: "okx" }, []);
  assert.equal(exchange?.icon, "exchange");
  assert.equal(exchange?.glyph, "okx");
  // A bogus exchange falls back to the letter icon rather than an empty mark.
  const bogus = makeFolder({ name: "Broker", icon: "exchange", glyph: "nope" }, []);
  assert.equal(bogus?.icon, "auto");
  assert.equal(bogus?.glyph, "");

  // The cap is enforced.
  const full = Array.from({ length: MAX_FOLDERS }, (_, index) => folder(`f${index}`));
  assert.equal(makeFolder({ name: "One more" }, full), null);
});

test("updateFolder renames, recolours and re-icons without touching other folders", () => {
  const folders = [folder("a", "Long term"), folder("b", "Play money")];
  const renamed = updateFolder(folders, "a", { name: " Forever ", color: "#ef4444" });
  assert.equal(renamed[0].name, "Forever");
  assert.equal(renamed[0].color, "#ef4444");
  assert.equal(renamed[1].name, "Play money");

  // A blank name keeps the old one, a bad colour is ignored.
  const blank = updateFolder(folders, "a", { name: "   ", color: "#123456" });
  assert.equal(blank[0].name, "Long term");
  assert.equal(blank[0].color, FOLDER_COLORS[0]);

  const icon = updateFolder(folders, "b", { icon: "emoji", glyph: "🎲" });
  assert.equal(icon[1].icon, "emoji");
  assert.equal(icon[1].glyph, "🎲");

  const collapsed = updateFolder(folders, "b", { collapsed: true });
  assert.equal(collapsed[1].collapsed, true);
});

test("removing a folder unfiles its holdings instead of dropping them", () => {
  const folders = [folder("a"), folder("b")];
  const assignments = { 1: "a", 2: "b", 3: "a" };
  const result = removeFolder(folders, assignments, "a");
  assert.deepEqual(result.folders.map((f) => f.id), ["b"]);
  assert.deepEqual(result.assignments, { 2: "b" });
});

test("assignHolding files and unfiles one holding, leaving the rest alone", () => {
  const before = { 1: "a", 2: "b" };
  assert.deepEqual(assignHolding(before, 3, "b"), { 1: "a", 2: "b", 3: "b" });
  assert.deepEqual(assignHolding(before, 1, "b"), { 1: "b", 2: "b" });
  assert.deepEqual(assignHolding(before, 1, null), { 2: "b" });
  assert.deepEqual(before, { 1: "a", 2: "b" });
});

test("folders can be nudged and dragged into a new order", () => {
  const folders = [folder("a"), folder("b"), folder("c")];
  assert.deepEqual(moveFolderBy(folders, "a", 1).map((f) => f.id), ["b", "a", "c"]);
  assert.deepEqual(moveFolderBy(folders, "a", -1).map((f) => f.id), ["a", "b", "c"]);
  assert.deepEqual(moveFolderBy(folders, "c", -99).map((f) => f.id), ["c", "a", "b"]);
  assert.deepEqual(moveFolderTo(folders, "a", "c", true).map((f) => f.id), ["b", "c", "a"]);
  assert.deepEqual(moveFolderTo(folders, "c", "a", false).map((f) => f.id), ["c", "a", "b"]);
  assert.deepEqual(moveFolderTo(folders, "a", "a", true).map((f) => f.id), ["a", "b", "c"]);
  // The input is never mutated.
  assert.deepEqual(folders.map((f) => f.id), ["a", "b", "c"]);
});

test("groupByFolder groups in folder order with unfiled rows last", () => {
  const folders = [folder("a"), folder("b"), folder("empty")];
  const rows = [
    { id: 1, value: 100 },
    { id: 2, value: 200 },
    { id: 3, value: 300 },
    { id: 4, value: 400 },
  ];
  const groups = groupByFolder(rows, folders, { 2: "b", 4: "a", 1: "a" });

  assert.deepEqual(groups.map((group) => group.folder?.id ?? null), ["a", "b", null]);
  // Inside a group the rows keep the order they arrived in (the table's sort).
  assert.deepEqual(groups[0].rows.map((row) => row.id), [1, 4]);
  assert.equal(groups[0].totalValue, 500);
  assert.deepEqual(groups[1].rows.map((row) => row.id), [2]);
  // The holding filed into a folder that no longer exists is unfiled, not lost.
  assert.deepEqual(groups[2].rows.map((row) => row.id), [3]);

  // No folders at all: one flat group, exactly the rows passed in.
  const flat = groupByFolder(rows, [], {});
  assert.equal(flat.length, 1);
  assert.equal(flat[0].folder, null);
  assert.deepEqual(flat[0].rows.map((row) => row.id), [1, 2, 3, 4]);
});

test("folder filters and counts agree with the filing", () => {
  const folders = [folder("a"), folder("b")];
  const ids = folders.map((f) => f.id);
  const assignments = { 1: "a", 2: "a", 3: "b" };

  assert.equal(countInFolder(assignments, "a"), 2);
  assert.equal(countInFolder(assignments, "b"), 1);
  assert.equal(countInFolder(assignments, "missing"), 0);

  assert.equal(matchesFolderFilter("all", 99, assignments, ids), true);
  assert.equal(matchesFolderFilter("folder:a", 1, assignments, ids), true);
  assert.equal(matchesFolderFilter("folder:a", 3, assignments, ids), false);
  assert.equal(matchesFolderFilter("folder:b", 3, assignments, ids), true);
  assert.equal(matchesFolderFilter("unfiled", 99, assignments, ids), true);
  assert.equal(matchesFolderFilter("unfiled", 1, assignments, ids), false);
});

test("nextFolderId slugifies names and never collides", () => {
  assert.equal(nextFolderId("Long term", []), "long-term");
  assert.equal(nextFolderId("Long term", ["long-term"]), "long-term-2");
  assert.equal(nextFolderId("Long term", ["long-term", "long-term-2"]), "long-term-3");
  assert.equal(nextFolderId("🏦 Bank", []), "bank");
  assert.equal(nextFolderId("$$$", []), "folder");
});

test("folders are saved, loaded and reset with the rest of the dashboard layout", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");

  const db = read("src/lib/dashboard-order-db.ts");
  assert.ok(db.includes('"holdings.folders"'), "folders live under holdings.folders");
  assert.ok(
    db.includes('"holdings.folderAssignments"'),
    "the filing lives under holdings.folderAssignments",
  );
  assert.ok(db.includes("saveHoldingsFolders"), "folders are written through saveHoldingsFolders");
  assert.ok(
    db.includes("saveHoldingFolderAssignments"),
    "the filing is written through saveHoldingFolderAssignments",
  );

  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes('"holdingFolders"'), "the save action reads the holdingFolders field");
  assert.ok(
    actions.includes('"holdingFolderAssignments"'),
    "the save action reads the filing too",
  );
  assert.ok(actions.includes("persistDashboardLayout("), "the save action stores the layout");

  const save = read("src/lib/dashboard-layout-save.ts");
  assert.ok(save.includes("parseHoldingsFolders("), "the layout save validates the folders");
  assert.ok(save.includes("clearHoldingsFolders("), "reset clears the folders");

  const layout = read("src/components/DashboardLayout.tsx");
  assert.ok(layout.includes("initialFolders"), "the layout receives the saved folders");
  assert.ok(layout.includes('fd.set("holdingFolders"'), "the layout sends the folders when saving");

  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(table.includes("<HoldingsFolders"), "the table renders the folder strip");
  assert.ok(table.includes("groupByFolder("), "the table groups holdings by folder");
  assert.ok(table.includes("folderControl("), "each holding shows its folder");

  const strip = read("src/components/HoldingsFolders.tsx");
  assert.ok(strip.includes("New folder"), "a folder can be created");
  assert.ok(strip.includes("PRICE_PROVIDERS"), "a folder can wear an exchange icon");
  assert.ok(strip.includes("aria-label=\"Custom folder icon"), "or a custom icon");
  assert.ok(strip.includes("onDragOver"), "holdings can be dragged onto a folder");
});
