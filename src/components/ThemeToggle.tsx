"use client";

import { toggleTheme } from "@/lib/theme";

export default function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      className="theme-toggle"
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <span className="theme-moon" aria-hidden="true">☾</span>
      <span className="theme-sun" aria-hidden="true">☀</span>
    </button>
  );
}
