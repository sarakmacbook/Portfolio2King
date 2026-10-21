"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/prices", label: "Refresh prices" },
  { href: "/activity", label: "Activity" },
  { href: "/database", label: "Database" },
];

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const linkClass = (href: string, mobile = false) => {
    const active = href === "/" ? path === "/" || path.startsWith("/assets") : path.startsWith(href);
    if (mobile) return `rounded-xl px-4 py-3 text-sm font-semibold ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`;
    return `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white/15 text-white" : "text-indigo-100 hover:bg-white/10 hover:text-white"
    }`;
  };

  return (
    <>
      <nav className="hidden items-center gap-1 sm:flex" aria-label="Main navigation">
        {links.map((link) => <Link key={link.href} href={link.href} className={linkClass(link.href)}>{link.label}</Link>)}
      </nav>
      <div className="sm:hidden">
        <button
          type="button"
          className="grid h-9 min-w-11 place-items-center rounded-xl bg-white/15 px-2 text-lg text-white ring-1 ring-white/20"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? "×" : "☰"}
        </button>
        {open && (
          <nav
            id="mobile-menu"
            className="absolute inset-x-4 top-[calc(100%+.5rem)] z-50 grid gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
            aria-label="Mobile navigation"
          >
            {links.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href, true)} onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
