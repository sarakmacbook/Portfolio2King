import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_FOLDER_LOGO_DATA_LENGTH,
  MAX_FOLDER_LOGO_SOURCE_BYTES,
  FOLDER_LOGO_SIZE,
  FOLDER_LOGO_ACCEPT,
  normaliseFolderLogo,
} from "../src/lib/folder-logo";
import {
  MAX_FOLDERS,
  normaliseFolders,
  makeFolder,
  updateFolder,
  type HoldingFolder,
} from "../src/lib/holdings-folders";

/** A tiny but structurally valid logo data URL. */
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const WEBP = `data:image/webp;base64,${"A".repeat(100)}`;

function folder(overrides: Partial<HoldingFolder> = {}): HoldingFolder {
  return {
    id: "long-term",
    name: "Long term",
    color: "#6366f1",
    icon: "auto",
    glyph: "",
    collapsed: false,
    ...overrides,
  };
}

test("only bounded png/jpeg/webp data URLs are accepted as a logo", () => {
  assert.equal(normaliseFolderLogo(LOGO), LOGO);
  assert.equal(normaliseFolderLogo(WEBP), WEBP);
  assert.equal(normaliseFolderLogo(`  ${LOGO}  `), LOGO);
  assert.equal(normaliseFolderLogo("data:image/jpeg;base64,AAAA"), "data:image/jpeg;base64,AAAA");
});

test("a logo can never smuggle in a script URL or an unbounded payload", () => {
  for (const bad of [
    "javascript:alert(1)",
    "https://evil.example/logo.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    // Right shape, but longer than the per-logo cap.
    `data:image/png;base64,${"A".repeat(MAX_FOLDER_LOGO_DATA_LENGTH)}`,
    "data:image/png;base64,",
    "",
    "   ",
    null,
    undefined,
    42,
    { toString: () => LOGO },
  ]) {
    assert.equal(normaliseFolderLogo(bad), undefined, `${String(bad).slice(0, 30)} is rejected`);
  }
});

test("stored folders keep an image icon and drop the logo when it is invalid", () => {
  const [withLogo] = normaliseFolders([
    { id: "bank", name: "Bank", color: "#14b8a6", icon: "image", glyph: "ignored", logo: LOGO },
  ]);
  assert.equal(withLogo.icon, "image");
  assert.equal(withLogo.logo, LOGO);
  // An image icon has no emoji/exchange glyph left behind.
  assert.equal(withLogo.glyph, "");

  const [broken] = normaliseFolders([
    { id: "bank", name: "Bank", color: "#14b8a6", icon: "image", logo: "nope" },
  ]);
  assert.equal(broken.icon, "auto");
  assert.equal(broken.logo, undefined);

  // Non-image icons never carry a logo, even if one is present in the setting.
  const [exchange] = normaliseFolders([
    { id: "bin", name: "Binance", color: "#f0b90b", icon: "exchange", glyph: "binance", logo: LOGO },
  ]);
  assert.equal(exchange.icon, "exchange");
  assert.equal(exchange.logo, undefined);
});

test("makeFolder turns an uploaded logo into an image icon", () => {
  const created = makeFolder({ name: "Savings", icon: "image", logo: LOGO }, []);
  assert.ok(created);
  assert.equal(created.icon, "image");
  assert.equal(created.logo, LOGO);
  assert.equal(created.glyph, "");

  // A rejected logo falls back to the letter rather than an empty square.
  const fallback = makeFolder({ name: "Savings", icon: "image", logo: "bad" }, []);
  assert.ok(fallback);
  assert.equal(fallback.icon, "auto");
  assert.equal(fallback.logo, undefined);
});

test("updateFolder adds, replaces, and removes a logo", () => {
  const original = [folder()];

  const added = updateFolder(original, "long-term", { icon: "image", logo: LOGO })[0];
  assert.equal(added.icon, "image");
  assert.equal(added.logo, LOGO);

  const replaced = updateFolder([added], "long-term", { icon: "image", logo: WEBP })[0];
  assert.equal(replaced.logo, WEBP);

  // Choosing another icon kind deletes the stored image instead of leaving it.
  const switched = updateFolder([added], "long-term", { icon: "exchange", glyph: "binance" })[0];
  assert.equal(switched.icon, "exchange");
  assert.equal(switched.glyph, "binance");
  assert.equal(switched.logo, undefined);
  assert.equal("logo" in switched, false);

  const removed = updateFolder([added], "long-term", { icon: "auto" })[0];
  assert.equal(removed.icon, "auto");
  assert.equal("logo" in removed, false);
});

test("the logo budget fits the server-action body limit", () => {
  // DashboardLayout sends every folder in one multipart POST capped at 1 MB.
  assert.ok(
    MAX_FOLDER_LOGO_DATA_LENGTH * MAX_FOLDERS < 900_000,
    `${MAX_FOLDERS} logos must stay under the action limit`,
  );
  assert.equal(FOLDER_LOGO_SIZE, 128);
  assert.ok(MAX_FOLDER_LOGO_SOURCE_BYTES >= 5 * 1024 * 1024);
  assert.ok(FOLDER_LOGO_ACCEPT.includes("image/png"));
});

test("the group editor offers an image and every render site draws it", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");

  const editor = read("src/components/HoldingsFolders.tsx");
  assert.ok(editor.includes("folderLogoFromFile("), "the editor converts the picked file");
  assert.ok(editor.includes("Add image"), "there is an Add image control");
  assert.ok(editor.includes("Replace image"), "an existing logo can be replaced");
  assert.ok(editor.includes("Remove image"), "an existing logo can be removed");
  assert.ok(editor.includes('accept={FOLDER_LOGO_ACCEPT}'), "the picker is limited to images");
  assert.ok(editor.includes("disabled={processingLogo}"), "saving waits for the resize");

  // Logos must reach every place a group is drawn, not just the editor preview.
  for (const file of [
    "src/components/HoldingsTable.tsx",
    "src/components/HoldingsFolders.tsx",
    "src/components/AssetSubfolders.tsx",
  ]) {
    assert.ok(read(file).includes('folder.icon === "image" ? folder.logo'), `${file} draws logos`);
  }

  // And the icon component has to actually render one.
  const icon = read("src/components/ExchangeIcon.tsx");
  assert.ok(icon.includes("logo?: string"));
  assert.ok(icon.includes("<img src={logo}"));
});

test("group icons are drawn large enough to be seen", () => {
  const table = readFileSync(
    join(resolve(__dirname, ".."), "src/components/HoldingsTable.tsx"),
    "utf8",
  );
  // The group header icon carries the group's identity, so it is 28px, and the
  // emoji/letter inside it scale with the box instead of a fixed 11px.
  assert.ok(table.includes('className="h-7 w-7 rounded-lg"'), "group header icon is 28px");

  const icon = readFileSync(
    join(resolve(__dirname, ".."), "src/components/ExchangeIcon.tsx"),
    "utf8",
  );
  assert.ok(icon.includes("text-[0.8em]"), "the emoji scales with the icon");
  assert.ok(icon.includes("text-[0.55em]"), "the letter scales with the icon");
});
