"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  PRIMARY_NAV_LINKS,
  SETTINGS_NAV_LINKS,
  isActivePath,
  isSettingsPath,
} from "@/lib/nav-links";

export default function Nav() {
  const path = usePathname();
  const inSettings = isSettingsPath(path);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(inSettings);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  const linkClass = (href: string, mobile = false) => {
    const active = isActivePath(path, href);
    if (mobile) {
      return `rounded-xl px-4 py-3 text-sm font-semibold ${
        active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
      }`;
    }
    return `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white/15 text-white" : "text-indigo-100 hover:bg-white/10 hover:text-white"
    }`;
  };

  return (
    <>
      <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
        {PRIMARY_NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={linkClass(link.href)}
            onClick={() => setSettingsOpen(false)}
          >
            {link.label}
          </Link>
        ))}

        <div ref={settingsRef} className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            aria-expanded={settingsOpen}
            aria-controls="settings-submenu"
            aria-haspopup="menu"
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              inSettings || settingsOpen
                ? "bg-white/15 text-white"
                : "text-indigo-100 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>Settings</span>
            <span className="text-[11px] opacity-80" aria-hidden="true">
              {settingsOpen ? "▴" : "▾"}
            </span>
          </button>

          {settingsOpen && (
            <div
              id="settings-submenu"
              role="menu"
              aria-label="Settings"
              className=" absolute right-0 top-[calc(100%+.5rem)] z-50 grid w-64 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
            >
              {SETTINGS_NAV_LINKS.map((link) => {
                const active = isActivePath(path, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    role="menuitem"
                    onClick={() => setSettingsOpen(false)}
                    className={`rounded-xl px-3.5 py-2.5 text-left transition ${
                      active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{link.label}</span>
                    {link.hint && (
                      <span
                        className={`block text-xs ${
                          active ? "text-indigo-700 opacity-80" : "text-slate-500"
                        }`}
                      >
                        {link.hint}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="md:hidden">
        <button
          type="button"
          className="grid h-9 min-w-11 place-items-center rounded-xl bg-white/15 px-2 text-lg text-white ring-1 ring-white/20"
          onClick={() => {
            setOpen((value) => {
              const next = !value;
              if (next && inSettings) setMobileSettingsOpen(true);
              return next;
            });
          }}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? "×" : "☰"}
        </button>
        <nav
          id="mobile-menu"
          className={`mobile-menu-panel absolute inset-x-4 top-[calc(100%+.5rem)] z-50 grid gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ${
            open ? "mobile-menu-open" : "mobile-menu-closed"
          }`}
          aria-label="Mobile navigation"
          aria-hidden={!open}
        >
          {PRIMARY_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(link.href, true)}
              onClick={() => setOpen(false)}
              tabIndex={open ? 0 : -1}
            >
              {link.label}
            </Link>
          ))}

          <div className="border-t border-slate-100 pt-1">
            <button
              type="button"
              onClick={() => setMobileSettingsOpen((value) => !value)}
              aria-expanded={mobileSettingsOpen}
              aria-controls="mobile-settings-submenu"
              tabIndex={open ? 0 : -1}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold ${
                inSettings ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>Settings</span>
              <span className="text-xs opacity-75" aria-hidden="true">
                {mobileSettingsOpen ? "▴" : "▾"}
              </span>
            </button>

            {mobileSettingsOpen && (
              <div
                id="mobile-settings-submenu"
                className="mt-1 grid gap-1 pl-3"
                aria-label="Settings submenu"
              >
                {SETTINGS_NAV_LINKS.map((link) => {
                  const active = isActivePath(path, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      tabIndex={open ? 0 : -1}
                      className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
                        active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block font-semibold">{link.label}</span>
                      {link.hint && (
                        <span
                          className={`block text-xs ${
                            active ? "text-indigo-700 opacity-80" : "text-slate-500"
                          }`}
                        >
                          {link.hint}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}
