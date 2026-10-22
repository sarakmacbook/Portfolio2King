import assert from "node:assert/strict";
import { test } from "node:test";
import {
  THEME_STORAGE_KEY,
  bootScript,
  nextTheme,
  resolveTheme,
} from "../src/lib/theme";

test("saved theme wins, otherwise the system preference decides", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(null, false), "light");
  assert.equal(resolveTheme(undefined, true), "dark");
  // Anything unexpected falls back to the system instead of throwing.
  assert.equal(resolveTheme("", true), "dark");
  assert.equal(resolveTheme("sepia", false), "light");
});

test("toggling always flips", () => {
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme(nextTheme("light")), "light");
});

/**
 * Executes the real inline script against a stub document, the way the browser
 * runs it in <head> before React hydrates.
 */
function runBoot(env: { saved?: string | null; prefersDark?: boolean; standalone?: boolean; storageThrows?: boolean }) {
  const classes = new Set<string>();
  const attributes: Record<string, string> = {};

  const documentElement = {
    classList: {
      add: (value: string) => classes.add(value),
      contains: (value: string) => classes.has(value),
    },
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
  };

  const storage = new Map<string, string>();
  if (env.saved) storage.set(THEME_STORAGE_KEY, env.saved);
  const localStorage = {
    getItem: (key: string) => {
      if (env.storageThrows) throw new Error("SecurityError");
      return storage.get(key) ?? null;
    },
  };

  const matchMedia = (query: string) => ({
    matches: query.includes("prefers-color-scheme")
      ? Boolean(env.prefersDark)
      : query.includes("display-mode: standalone") || query.includes("display-mode: fullscreen")
        ? Boolean(env.standalone)
        : false,
    media: query,
  });

  new Function("document", "localStorage", "matchMedia", "navigator", bootScript())(
    { documentElement },
    localStorage,
    matchMedia,
    { standalone: Boolean(env.standalone) },
  );

  return { dark: classes.has("dark"), webclip: attributes["data-webclip"] === "true" };
}

test("the pre-paint script applies the stored or system theme", () => {
  assert.equal(runBoot({ saved: "dark", prefersDark: false }).dark, true);
  assert.equal(runBoot({ saved: "light", prefersDark: true }).dark, false);
  assert.equal(runBoot({ prefersDark: true }).dark, true);
  assert.equal(runBoot({ prefersDark: false }).dark, false);
});

test("the pre-paint script marks an installed web clip", () => {
  assert.equal(runBoot({ standalone: true }).webclip, true);
  assert.equal(runBoot({ standalone: false }).webclip, false);
  // Both can be true at once: a dark web clip.
  assert.deepEqual(runBoot({ standalone: true, prefersDark: true }), { dark: true, webclip: true });
});

test("blocked storage does not stop the web clip flag", () => {
  // Private browsing where localStorage throws: the theme falls back, but the
  // strip must still be marked so the installed app has navigation.
  const result = runBoot({ standalone: true, storageThrows: true });
  assert.equal(result.webclip, true);
  assert.equal(result.dark, false);
});

test("the script is self-contained and points at the stored key", () => {
  const script = bootScript();
  assert.ok(script.includes(THEME_STORAGE_KEY));
  assert.ok(script.includes("prefers-color-scheme: dark"));
  assert.ok(script.includes("data-webclip"));
  // Two independent try blocks: a storage failure cannot skip the web clip flag.
  assert.equal(script.match(/try\{/g)?.length, 2);
});
