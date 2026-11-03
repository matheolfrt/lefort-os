"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentTab, hubTabs } from "@/lib/nav";

/** The tab bar of a hub (Ventes, Rotation, Mon argent): its pages one click apart, on every screen size */
export function HubTabs({ isManager }: { isManager: boolean }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);
  // on a phone the bar scrolls sideways: bring the current tab into view
  useEffect(() => {
    const nav = bar.current, tab = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
    const t = tab.getBoundingClientRect(), n = nav.getBoundingClientRect();
    if (t.left < n.left || t.right > n.right) nav.scrollLeft += t.left - n.left - 16;
  }, [path]);
  const tabs = hubTabs(path, isManager);
  if (!tabs) return null;
  const on = currentTab(tabs, path);
  return (
    <nav ref={bar} aria-label="Pages de la section" data-hub-tabs className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex min-w-max gap-1 rounded-full bg-[var(--fill)] p-1">
        {tabs.map(({ href, label, tabLabel, icon: Icon }) => (
          <Link key={href} href={href} aria-current={on === href ? "page" : undefined}
            className={`flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
              on === href ? "bg-[var(--seg-on)] text-fg shadow-[0_1px_3px_rgb(0_0_0/0.14)]" : "text-muted hover:text-fg"}`}>
            <Icon size={16} /> {tabLabel ?? label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
