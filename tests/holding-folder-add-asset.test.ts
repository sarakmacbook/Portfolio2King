import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("a new holding can be assigned to a folder from the Add holding form", () => {
  const dialog = read("src/components/AddAssetDialog.tsx");
  assert.ok(dialog.includes('name="folderId"'), "the form submits the selected folder id");
  assert.ok(dialog.includes("Choose a folder to file this holding there"), "the folder selector is explained");

  const actions = read("src/app/actions.ts");
  const create = actions.slice(actions.indexOf("export async function createAsset"), actions.indexOf("export async function updateAsset"));
  assert.ok(create.includes('str(fd, "folderId")'), "asset creation reads the folder selection");
  assert.ok(create.includes("setHoldingFolder(newId, folderId)"), "the new asset is filed into the selected folder");
});
