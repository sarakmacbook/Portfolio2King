import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("a new holding can be assigned to a folder from the Add holding form", () => {
  const dialog = read("src/components/AddAssetDialog.tsx");
  assert.ok(dialog.includes('name="folderId"'), "the form submits the selected or new-folder choice");
  assert.ok(dialog.includes("Create a new folder…"), "the form can create a folder inline");
  assert.ok(dialog.includes('name="folderName"'), "the new folder name is submitted with the holding");

  const actions = read("src/app/actions.ts");
  const create = actions.slice(actions.indexOf("export async function createAsset"), actions.indexOf("export async function updateAsset"));
  assert.ok(create.includes('str(fd, "folderId")'), "asset creation reads the folder selection");
  assert.ok(create.includes('str(fd, "folderName")'), "asset creation reads the new folder name");
  assert.ok(create.includes("folderToCreate = makeFolder("), "the selected new folder is prepared server-side");
  assert.ok(create.includes("saveHoldingsFolders([...foldersBeforeCreate, folderToCreate])"), "the new folder is saved with the asset");
  assert.ok(create.includes("setHoldingFolder(newId, folderId)"), "the new asset is filed into the selected folder");
});
