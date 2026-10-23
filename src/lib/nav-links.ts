/** Shared navigation targets for the header menu. */
export type NavLink = {
  href: string;
  label: string;
};

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/exchanges", label: "Exchanges" },
  { href: "/prices", label: "Refresh prices" },
  { href: "/activity", label: "Activity" },
  { href: "/alerts", label: "Alerts" },
  { href: "/database", label: "Database" },
];

/** True when `path` belongs to `href` (the dashboard also owns asset pages). */
export function isActivePath(path: string, href: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/assets");
  return path === href || path.startsWith(`${href}/`);
}
