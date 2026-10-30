import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("an asset can be filed into a folder from the Edit form", () => {
  const forms = read("src/components/AssetForms.tsx");
  assert.ok(forms.includes('name="folderId"'), "the edit form submits the selected folder");
  assert.ok(forms.includes("Create a new folder…"), "the edit form can create a folder inline");
  assert.ok(forms.includes('name="folderName"'), "the new folder name is submitted with the update");

  const actions = read("src/app/actions.ts");
  const update = actions.slice(
    actions.indexOf("export async function updateAsset"),
    actions.indexOf("export async function updatePrice"),
  );
  assert.ok(update.includes('fd.has("folderId")'), "asset update only files when the form sends the folder field");
  assert.ok(update.includes('str(fd, "folderId")'), "asset update reads the folder selection");
  assert.ok(update.includes('str(fd, "folderName")'), "asset update reads the new folder name");
  assert.ok(update.includes("makeFolder("), "the selected new folder is prepared server-side");
  assert.ok(update.includes("saveHoldingsFolders([...folders, folder])"), "the new folder is saved");
  assert.ok(update.includes("setHoldingFolder(id, folderId || null)"), "the asset is filed, or unfiled, after the update");

  const page = read("src/app/assets/[id]/page.tsx");
  assert.ok(page.includes("folders={folderChoices}"), "the asset page offers the existing folders");
  assert.ok(page.includes('folderId={assignments[asset.id] ?? ""}'), "the asset page preselects the current folder");
});
