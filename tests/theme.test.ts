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
function runBoot(env: { saved?: string | null; prefersDark?: boolean; storageThrows?: boolean }) {
  const classes = new Set<string>();

  const documentElement = {
    classList: {
      add: (value: string) => classes.add(value),
      contains: (value: string) => classes.has(value),
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
    matches: query.includes("prefers-color-scheme") ? Boolean(env.prefersDark) : false,
    media: query,
  });

  new Function("document", "localStorage", "matchMedia", bootScript())(
    { documentElement },
    localStorage,
    matchMedia,
  );

  return { dark: classes.has("dark") };
}

test("the pre-paint script applies the stored or system theme", () => {
  assert.equal(runBoot({ saved: "dark", prefersDark: false }).dark, true);
  assert.equal(runBoot({ saved: "light", prefersDark: true }).dark, false);
  assert.equal(runBoot({ prefersDark: true }).dark, true);
  assert.equal(runBoot({ prefersDark: false }).dark, false);
});

test("blocked storage falls back to the light theme", () => {
  // Private browsing where localStorage throws must not break the page.
  assert.deepEqual(runBoot({ storageThrows: true }), { dark: false });
  assert.deepEqual(runBoot({ storageThrows: true, prefersDark: true }), { dark: false });
});

test("the script is self-contained and points at the stored key", () => {
  const script = bootScript();
  assert.ok(script.includes(THEME_STORAGE_KEY));
  assert.ok(script.includes("prefers-color-scheme: dark"));
  // Wrapped so a locked-down browser cannot throw before the page renders.
  assert.equal(script.match(/try\{/g)?.length, 1);
});
