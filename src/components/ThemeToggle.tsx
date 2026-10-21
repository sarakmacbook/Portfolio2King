"use client";

export default function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("ledgerly-theme", next ? "dark" : "light");
  }

  return (
    <button type="button" onClick={toggle} className="theme-toggle" aria-label="Toggle color theme" title="Toggle color theme">
      <span className="theme-moon" aria-hidden="true">☾</span>
      <span className="theme-sun" aria-hidden="true">☀</span>
    </button>
  );
}
