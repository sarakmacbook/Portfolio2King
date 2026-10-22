"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { NAV_LINKS, isActivePath } from "@/lib/nav-links";

/**
 * The tab strip shown when Ledgerly is running as an installed web clip
 * (iOS "Add to Home Screen", Android PWA).
 *
 * It is always rendered so the markup is identical on the server and the
 * client; CSS shows it only when the `<html>` element carries `data-webclip`,
 * which the inline script in the root layout sets before the first paint.
 * `display: none` also keeps it out of the accessibility tree in a browser tab,
 * where the regular header navigation is used instead.
 */
export default function WebClipTabs() {
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);

  // On a narrow phone the strip scrolls, so keep the current section visible.
  useEffect(() => {
    const strip = nav.current;
    const active = strip?.querySelector<HTMLElement>(".webclip-tab.is-active");
    if (!strip || !active) return;
    if (active.offsetLeft < strip.scrollLeft || active.offsetLeft + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = active.offsetLeft - 16;
    }
  }, [path]);

  return (
    <nav ref={nav} className="webclip-tabs" aria-label="Main navigation">
      <div className="webclip-tabs-row">
        {NAV_LINKS.map((link) => {
          const active = isActivePath(path, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`webclip-tab${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {link.tab}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
