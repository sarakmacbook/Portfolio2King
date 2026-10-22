/** Shared navigation targets so the in-page nav and the web clip tabs never drift. */
export type NavLink = {
  href: string;
  /** Full label used in the header menu. */
  label: string;
  /** Short label for the installed web clip tab bar. */
  tab: string;
};

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", tab: "Home" },
  { href: "/prices", label: "Refresh prices", tab: "Prices" },
  { href: "/activity", label: "Activity", tab: "Activity" },
  { href: "/alerts", label: "Alerts", tab: "Alerts" },
  { href: "/database", label: "Database", tab: "Database" },
];

/** True when `path` belongs to `href` (the dashboard also owns asset pages). */
export function isActivePath(path: string, href: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/assets");
  return path === href || path.startsWith(`${href}/`);
}
