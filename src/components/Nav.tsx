"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRIMARY_NAV_LINKS,
  SETTINGS_NAV_LINKS,
  isActivePath,
  isSettingsPath,
} from "@/lib/nav-links";
import { PrivacyMenuItems } from "./PrivacyMenu";

type DesktopMenu = "settings" | "privacy" | null;

const MOBILE_MENU_ID = "mobile-menu";
const SETTINGS_MENU_ID = "settings-submenu";
const PRIVACY_MENU_ID = "privacy-submenu";

/**
 * Header navigation.
 *
 * There is exactly one menu open at a time, and exactly one place that hides or
 * reveals balances in each layout: the ☰ sheet on phones and the Privacy
 * dropdown on desktop (`PrivacyMenuItems`). The header itself only carries the
 * logo, the menu button and the theme toggle on small screens, so the iPhone
 * web clip keeps a roomy, single-row header with 44 px tap targets.
 */
export default function Nav() {
  const path = usePathname();
  const inSettings = isSettingsPath(path);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [desktopMenu, setDesktopMenu] = useState<DesktopMenu>(null);
  const desktopNavRef = useRef<HTMLElement>(null);

  const closeAll = useCallback(() => {
    setMobileOpen(false);
    setDesktopMenu(null);
  }, []);

  // Escape closes, an outside tap closes, and one open menu replaces the other.
  useEffect(() => {
    if (!mobileOpen && !desktopMenu) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (mobileOpen) {
        const panel = document.getElementById(MOBILE_MENU_ID);
        const trigger = document.getElementById("mobile-menu-button");
        if (!panel?.contains(target) && !trigger?.contains(target)) setMobileOpen(false);
        return;
      }
      if (desktopMenu && !desktopNavRef.current?.contains(target)) setDesktopMenu(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      setDesktopMenu(null);
      document.getElementById("mobile-menu-button")?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen, desktopMenu]);

  // Freeze the page behind the phone sheet. iOS needs both roots locked, and
  // both are restored so nothing stays stuck after the sheet closes.
  useEffect(() => {
    if (!mobileOpen) return;
    const { body, documentElement } = document;
    const previousBody = body.style.overflow;
    const previousHtml = documentElement.style.overflow;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousBody;
      documentElement.style.overflow = previousHtml;
    };
  }, [mobileOpen]);

  // Rotating an iPhone or growing the window past 768 px drops the sheet.
  useEffect(() => {
    if (!mobileOpen) return;
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (query.matches) setMobileOpen(false);
    };
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mobileOpen]);

  function toggleMobile() {
    const next = !mobileOpen;
    setDesktopMenu(null);
    setMobileOpen(next);
    // Re-open the Settings section only when the current page lives there.
    setMobileSettingsOpen(next ? inSettings : false);
  }

  const desktopLinkClass = (href: string) => {
    const active = isActivePath(path, href);
    return `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white/15 text-white" : "text-indigo-100 hover:bg-white/10 hover:text-white"
    }`;
  };

  const desktopTriggerClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white/15 text-white" : "text-indigo-100 hover:bg-white/10 hover:text-white"
    }`;

  const mobileRowClass = (active: boolean) =>
    `flex min-h-11 items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
      active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <>
      <nav
        ref={desktopNavRef}
        className="hidden items-center gap-1 md:flex"
        aria-label="Main navigation"
      >
        {PRIMARY_NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={desktopLinkClass(link.href)}
            aria-current={isActivePath(path, link.href) ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}

        <div className="relative">
          <button
            type="button"
            onClick={() => setDesktopMenu((value) => (value === "settings" ? null : "settings"))}
            aria-expanded={desktopMenu === "settings"}
            aria-controls={SETTINGS_MENU_ID}
            aria-haspopup="menu"
            className={desktopTriggerClass(inSettings || desktopMenu === "settings")}
          >
            <span>Settings</span>
            <span className="text-[11px] opacity-80" aria-hidden="true">
              {desktopMenu === "settings" ? "▴" : "▾"}
            </span>
          </button>

          {desktopMenu === "settings" && (
            <div
              id={SETTINGS_MENU_ID}
              role="menu"
              aria-label="Settings"
              className="menu-surface absolute right-0 top-[calc(100%+.5rem)] z-50 grid w-64 gap-1 rounded-2xl p-2"
            >
              {SETTINGS_NAV_LINKS.map((link) => {
                const active = isActivePath(path, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    role="menuitem"
                    onClick={closeAll}
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

        <div className="relative">
          <button
            type="button"
            onClick={() => setDesktopMenu((value) => (value === "privacy" ? null : "privacy"))}
            aria-expanded={desktopMenu === "privacy"}
            aria-controls={PRIVACY_MENU_ID}
            aria-haspopup="menu"
            aria-label="Privacy options"
            title="Privacy — hide or reveal balances"
            className={desktopTriggerClass(desktopMenu === "privacy")}
          >
            <span aria-hidden="true">👁</span>
            <span>Privacy</span>
            <span className="text-[11px] opacity-80" aria-hidden="true">
              {desktopMenu === "privacy" ? "▴" : "▾"}
            </span>
          </button>

          {desktopMenu === "privacy" && (
            <div
              id={PRIVACY_MENU_ID}
              role="menu"
              aria-label="Privacy"
              className="menu-surface absolute right-0 top-[calc(100%+.5rem)] z-50 w-80 rounded-2xl p-2"
            >
              <PrivacyMenuItems compact onDone={closeAll} />
            </div>
          )}
        </div>
      </nav>

      <div className="md:hidden">
        <button
          id="mobile-menu-button"
          type="button"
          onClick={toggleMobile}
          aria-expanded={mobileOpen}
          aria-controls={MOBILE_MENU_ID}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="tap grid h-11 min-w-11 place-items-center rounded-xl bg-white/15 px-2 text-lg text-white ring-1 ring-white/20 transition active:scale-95"
        >
          <span aria-hidden="true">{mobileOpen ? "✕" : "☰"}</span>
        </button>

        {mobileOpen && (
          <nav
            id={MOBILE_MENU_ID}
            className="mobile-menu-panel menu-surface absolute inset-x-3 top-[calc(100%+.5rem)] z-50 grid gap-1 rounded-2xl p-2"
            aria-label="Mobile navigation"
          >
            {PRIMARY_NAV_LINKS.map((link) => {
              const active = isActivePath(path, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeAll}
                  aria-current={active ? "page" : undefined}
                  className={mobileRowClass(active)}
                >
                  <span>{link.label}</span>
                  {active && (
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
                      Now
                    </span>
                  )}
                </Link>
              );
            })}

            <div className="my-1 border-t border-slate-100" />

            <button
              type="button"
              onClick={() => setMobileSettingsOpen((value) => !value)}
              aria-expanded={mobileSettingsOpen}
              aria-controls="mobile-settings-submenu"
              className={mobileRowClass(inSettings && !mobileSettingsOpen)}
            >
              <span>Settings</span>
              <span className="text-xs opacity-75" aria-hidden="true">
                {mobileSettingsOpen ? "▴" : "▾"}
              </span>
            </button>

            {mobileSettingsOpen && (
              <div id="mobile-settings-submenu" className="grid gap-1 pl-3">
                {SETTINGS_NAV_LINKS.map((link) => {
                  const active = isActivePath(path, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={closeAll}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-xl px-4 py-2.5 text-sm ${
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

            <div className="my-1 border-t border-slate-100" />

            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Privacy
            </p>
            <PrivacyMenuItems onDone={closeAll} />
          </nav>
        )}
      </div>
    </>
  );
}
