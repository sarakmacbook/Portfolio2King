import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("dark-mode CSS overrides every light surface, text, border, and ring token used across src/", () => {
  const rootDir = resolve(__dirname, "..");
  const css = readFileSync(join(rootDir, "src/app/globals.css"), "utf8");

  const darkSelectors = new Set<string>();
  for (const line of css.split("\n")) {
    if (!line.includes("html.dark")) continue;
    for (const match of line.matchAll(/html\.dark\s+\.([a-zA-Z0-9_\\/:.-]+)/g)) {
      const normalized = match[1]
        .replace(/\\:/g, ":")
        .replace(/\\\//g, "/")
        .replace(/:(hover|focus)$/, "");
      darkSelectors.add(normalized);
    }
  }

  for (const required of [
    "bg-white",
    "bg-white/80",
    "hover:bg-white",
    "bg-slate-50",
    "bg-slate-50/40",
    "bg-slate-50/60",
    "hover:bg-slate-50/70",
    "hover:bg-slate-50/80",
    "bg-indigo-50",
    "bg-indigo-50/40",
    "bg-indigo-50/50",
    "bg-indigo-50/60",
    "bg-indigo-50/80",
    "text-amber-700",
    "text-amber-800",
    "text-amber-900",
    "text-emerald-900",
    "text-indigo-900",
    "text-indigo-700/70",
    "border-indigo-300",
    "hover:border-indigo-300",
    "ring-offset-slate-50",
  ]) {
    assert.ok(darkSelectors.has(required), `Expected html.dark override for .${required}`);
  }

  assert.ok(css.includes("html.dark .input:disabled"));
  assert.ok(css.includes("html.dark .input::file-selector-button"));
  assert.ok(css.includes("html.dark .bg-slate-900 .text-slate-300"));

  // Intentional dark-invariant tokens (header gradient, status dots, destructive buttons, modal backdrop).
  const allowlist = new Set([
    "bg-emerald-500",
    "bg-rose-500",
    "bg-rose-600",
    "hover:bg-rose-700",
    "bg-slate-900/40",
    "bg-white/15",
    "hover:bg-white/10",
    "from-indigo-500",
    "from-indigo-700",
    "via-indigo-600",
    "to-violet-600",
    "hover:text-white",
    "ring-white/20",
    "ring-white/25",
    "text-indigo-100",
    "text-slate-100",
    "text-white",
  ]);

  const tokenRe =
    /\b((?:hover:|focus:)?(?:bg|text|border|divide|ring|ring-offset|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?)\b/g;

  const missing: string[] = [];
  for (const file of walkSourceFiles(join(rootDir, "src"))) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(tokenRe)) {
      const token = match[1];
      if (!darkSelectors.has(token) && !allowlist.has(token)) {
        missing.push(`${token} in ${file.slice(rootDir.length + 1)}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test("HoldingsTable active filter pill uses opacity rather than light slate text inside inverted bg-slate-900", () => {
  const rootDir = resolve(__dirname, "..");
  const holdings = readFileSync(join(rootDir, "src/components/HoldingsTable.tsx"), "utf8");
  assert.ok(
    holdings.includes('filter === value ? "opacity-70" : "text-slate-400"'),
    "Active filter pill badge should use opacity-70 so it stays readable when bg-slate-900 inverts in dark mode",
  );
});

