import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const rootDir = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(rootDir, path), "utf8");

test("hide/reveal lives in exactly one menu, not in the header or a banner", () => {
  const nav = read("src/components/Nav.tsx");
  const layout = read("src/app/layout.tsx");
  const provider = read("src/components/PrivacyProvider.tsx");
  const menu = read("src/components/PrivacyMenu.tsx");

  // The ☰ sheet (phones) and the Privacy dropdown (desktop) both render the
  // same rows, so the two layouts can never drift apart.
  assert.equal(nav.match(/<PrivacyMenuItems/g)?.length, 2);
  assert.ok(nav.includes("Privacy options"));

  // No second eye/lock control anywhere else in the chrome.
  assert.equal(provider.includes("PrivacyHeaderControl"), false);
  assert.equal(layout.includes("PrivacyHeaderControl"), false);

  // Only the menu calls the provider actions that toggle masking.
  assert.ok(menu.includes("hideBalances"));
  assert.ok(menu.includes("requestRevealBalances"));
  const gate = provider.slice(provider.indexOf("export function PrivacyGate"));
  assert.equal(gate.includes("requestRevealBalances()"), false);
  assert.equal(gate.includes("hideBalances()"), false);
});

test("phone menu is a contained, scrollable, safe-area-aware sheet", () => {
  const css = read("src/app/globals.css");

  assert.ok(css.includes(".mobile-menu-panel"));
  assert.ok(/max-height:\s*calc\(100dvh[^;]*env\(safe-area-inset-top\)/.test(css));
  assert.ok(css.includes("overflow-y: auto"));
  assert.ok(css.includes("overscroll-behavior: contain"));

  // The old always-on compositor hints are what made iOS Safari paint the
  // panel outside its own box; the menu animates on mount instead.
  const panel = css.slice(css.indexOf(".mobile-menu-panel {"), css.indexOf("@keyframes menu-pop"));
  assert.equal(panel.includes("will-change"), false);
  assert.equal(panel.includes("backface-visibility"), false);
  assert.ok(css.includes("@keyframes menu-pop"));

  // Opaque surface in both themes so scrolled content never bleeds through.
  assert.ok(css.includes(".menu-surface"));
  assert.ok(css.includes("html.dark .menu-surface"));
});

test("iOS web clip metadata requests a full-screen, notch-aware app", () => {
  const layout = read("src/app/layout.tsx");
  const manifest = read("src/app/manifest.ts");

  assert.ok(layout.includes('statusBarStyle: "black-translucent"'));
  assert.ok(layout.includes('viewportFit: "cover"'));
  assert.ok(layout.includes("formatDetection"));
  assert.ok(layout.includes("manifest: \"/manifest.webmanifest\""));

  assert.ok(manifest.includes('display: "standalone"'));
  assert.ok(manifest.includes('scope: "/"'));
  assert.ok(manifest.includes('orientation: "portrait"'));
  assert.ok(manifest.includes('purpose: "maskable"'));
});

test("the header stays reachable and tappable on an iPhone", () => {
  const layout = read("src/app/layout.tsx");
  const css = read("src/app/globals.css");
  const nav = read("src/components/Nav.tsx");

  assert.ok(layout.includes("site-header sticky top-0"));
  assert.ok(css.includes("padding-top: env(safe-area-inset-top)"));
  assert.ok(css.includes("padding-bottom: calc(.5rem + env(safe-area-inset-bottom))"));

  // 44 px minimum touch targets for the phone header controls.
  assert.ok(nav.includes("h-11 min-w-11"));
  assert.ok(css.includes("height: 2.75rem"));
  assert.ok(css.includes("touch-action: manipulation"));
});
