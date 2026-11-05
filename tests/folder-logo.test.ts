import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_FOLDER_LOGO_DATA_LENGTH,
  normaliseFolderLogo,
} from "../src/lib/folder-logo";
import {
  makeFolder,
  normaliseFolders,
  updateFolder,
} from "../src/lib/holdings-folders";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const WEBP = "data:image/webp;base64,UklGRg==";

test("group logo validation accepts bounded PNG, JPEG, and WebP data only", () => {
  assert.equal(normaliseFolderLogo(PNG), PNG);
  assert.equal(normaliseFolderLogo(WEBP), WEBP);
  assert.equal(
    normaliseFolderLogo("data:image/jpeg;base64,/9g="),
    "data:image/jpeg;base64,/9g=",
  );
  assert.equal(normaliseFolderLogo(`  ${PNG}  `), PNG);
  assert.equal(normaliseFolderLogo("https://example.com/logo.png"), undefined);
  assert.equal(normaliseFolderLogo("data:image/svg+xml;base64,PHN2Zz4="), undefined);
  assert.equal(normaliseFolderLogo("data:image/png;base64,not valid!"), undefined);
  assert.equal(
    normaliseFolderLogo(`data:image/png;base64,${"A".repeat(MAX_FOLDER_LOGO_DATA_LENGTH)}`),
    undefined,
  );
});

test("folder normalisation preserves valid uploaded logos and rejects unsafe ones", () => {
  const [custom] = normaliseFolders([
    { id: "custom", name: "Custom", icon: "image", glyph: "ignored", logo: WEBP },
  ]);
  assert.equal(custom.icon, "image");
  assert.equal(custom.glyph, "");
  assert.equal(custom.logo, WEBP);
  assert.deepEqual(normaliseFolders(JSON.stringify([custom])), [custom]);

  const [unsafe] = normaliseFolders([
    { id: "unsafe", name: "Unsafe", icon: "image", logo: "javascript:alert(1)" },
  ]);
  assert.equal(unsafe.icon, "auto");
  assert.equal(unsafe.logo, undefined);
});

test("a group logo can be added, replaced, and removed without losing the group", () => {
  const created = makeFolder({ name: "My group", icon: "image", logo: WEBP }, []);
  assert.ok(created);
  assert.equal(created.icon, "image");
  assert.equal(created.logo, WEBP);

  const replaced = updateFolder([created], created.id, { logo: PNG });
  assert.equal(replaced[0].icon, "image");
  assert.equal(replaced[0].logo, PNG);

  const removed = updateFolder(replaced, created.id, { icon: "auto" });
  assert.equal(removed[0].icon, "auto");
  assert.equal("logo" in removed[0], false);

  const invalid = updateFolder(replaced, created.id, { logo: "not-an-image" });
  assert.equal(invalid[0].icon, "auto");
  assert.equal(invalid[0].logo, undefined);
});

test("the group editor exposes upload, replace, remove, and preview controls", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");
  const editor = read("src/components/HoldingsFolders.tsx");
  assert.ok(editor.includes("folderLogoFromFile(file)"));
  assert.ok(editor.includes('type="file"'));
  assert.ok(editor.includes("accept={FOLDER_LOGO_ACCEPT}"));
  assert.ok(editor.includes("Replace logo"));
  assert.ok(editor.includes("Remove logo"));
  assert.ok(editor.includes('logo={draftIcon === "image" ? draftLogo : undefined}'));

  const icon = read("src/components/ExchangeIcon.tsx");
  assert.ok(icon.includes('from "next/image"'));
  assert.ok(icon.includes("src={logo}"));
  for (const file of [
    "src/components/HoldingsTable.tsx",
    "src/components/HoldingsFolders.tsx",
    "src/components/AssetSubfolders.tsx",
  ]) {
    assert.ok(read(file).includes('icon === "image"'), `${file} renders uploaded group logos`);
  }
});
