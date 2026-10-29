"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentTab, hubTabs } from "@/lib/nav";

/** The tab bar of a hub (Ventes, Rotation, Mon argent): its pages one click apart, on every screen size */
export function HubTabs({ isManager }: { isManager: boolean }) {
  const path = usePathname();
  const tabs = hubTabs(path, isManager);
  if (!tabs) return null;
  const on = currentTab(tabs, path);
  return (
    <nav aria-label="Pages de la section" data-hub-tabs className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex min-w-max gap-1 rounded-2xl border border-line bg-panel/70 p-1">
        {tabs.map(({ href, label, tabLabel, icon: Icon }) => (
          <Link key={href} href={href} aria-current={on === href ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors ${
              on === href ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent/30" : "text-muted hover:bg-fg/5 hover:text-fg"}`}>
            <Icon size={16} /> {tabLabel ?? label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
