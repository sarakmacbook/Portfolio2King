/**
 * Theme handling shared by the header switch, the web clip strip and the
 * pre-paint inline script in the root layout.
 *
 * The inline script runs before React, so the rules live in one place here and
 * are exported as a string (`bootScript`) rather than duplicated in JSX.
 */

export const THEME_STORAGE_KEY = "ledgerly-theme";

export type Theme = "light" | "dark";

/** Saved choice wins; otherwise follow the operating system. */
export function resolveTheme(saved: string | null | undefined, prefersDark: boolean): Theme {
  if (saved === "dark" || saved === "light") return saved;
  return prefersDark ? "dark" : "light";
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/** Theme currently applied to the document (server renders are always light-first). */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Applies a theme and remembers it for the next visit. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing with storage disabled: the theme still applies to this page.
  }
}

export function toggleTheme(): Theme {
  const next = nextTheme(currentTheme());
  applyTheme(next);
  return next;
}

/**
 * Inline script for `<head>`, run before the first paint:
 *
 * 1. Marks the document as a web clip so the tab strip can show without a
 *    flash of the browser header.
 * 2. Applies the saved (or system) theme.
 *
 * The two steps are separate `try` blocks on purpose: storage can throw in
 * private browsing, and that must not stop the web clip flag from being set.
 */
export function bootScript(): string {
  return (
    `(function(){` +
    `try{var d=document.documentElement;` +
    `var s=(matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches||navigator.standalone===true);` +
    `if(s)d.setAttribute('data-webclip','true')}catch(e){}` +
    `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    `if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` +
    `})()`
  );
}
