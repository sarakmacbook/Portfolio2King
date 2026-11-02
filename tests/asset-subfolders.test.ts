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
  assert.ok(!section.includes("allowCreateFolder={false}"), "the add dialog can create folders, same as on the dashboard");
  // New style: a chip strip like the Holdings folder bar owns creation and filtering.
  assert.ok(section.includes("＋ New folder"), "a dashed chip opens the inline create field");
  assert.ok(section.includes("Create folder"), "the inline field creates the subfolder");
  assert.ok(section.includes("ExchangeIcon"), "chips and cards wear the folder icon");
  assert.ok(section.includes('useState<string>("all")'), "chips filter the folder cards below");
  assert.ok(/>\s*All\s*</.test(section), "an All chip shows every subfolder at once");
  assert.ok(
    section.includes("newFolderParentAssetId={parentAssetId}"),
    "a folder made in the add dialog is nested inside the current holding",
  );

  const dialog = read("src/components/AddAssetDialog.tsx");
  assert.ok(dialog.includes('name="newFolderParentAssetId"'), "the add dialog tells the server which holding owns the new folder");

  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes("export async function createAssetSubfolder"), "the server validates and stores nested folders");
  assert.ok(actions.includes("makeFolder({ name, parentAssetId }, current)"), "the folder stores its parent holding id");
  assert.ok(actions.includes('str(fd, "newFolderParentAssetId")'), "createAsset reads the parent holding from the add-asset form");
  assert.ok(
    actions.includes("{ name: folderName, ...(parentAssetId ? { parentAssetId } : {}) }"),
    "a new folder from the add-asset dialog is nested inside that holding",
  );
  assert.ok(
    actions.includes("revalidatePath(`/assets/${folderToCreate.parentAssetId}`)"),
    "the holding's page is refreshed so the new subfolder shows up",
  );
});
