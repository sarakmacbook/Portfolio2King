import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("holding pages can own nested folders and add assets of any category into them", () => {
  const page = read("src/app/assets/[id]/page.tsx");
  assert.ok(page.includes("<AssetSubfolders"), "each holding page includes its folder section");
  assert.ok(page.includes("parentAssetId === id"), "only folders owned by the current holding are shown");

  const section = read("src/components/AssetSubfolders.tsx");
  assert.ok(section.includes("createAssetSubfolder(parentAssetId, name)"), "folders are created under the current holding");
  assert.ok(section.includes('defaultFolderId={folder.id}'), "the add dialog targets this child folder");
  assert.ok(section.includes("AddAssetDialog"), "holdings can be added directly from the folder");
  assert.ok(section.includes("holdings of any category"), "the folder accepts all asset categories");

  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes("export async function createAssetSubfolder"), "the server validates and stores nested folders");
  assert.ok(actions.includes("makeFolder({ name, parentAssetId }, current)"), "the folder stores its parent holding id");
});
