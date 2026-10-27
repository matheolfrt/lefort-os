"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PILOTAGE_TABS } from "@/lib/nav";

export function PilotageTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Pilotage" data-pilotage-tabs className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex min-w-max gap-1 rounded-2xl border border-line bg-panel/70 p-1">
        {PILOTAGE_TABS.map(({ href, label, icon: Icon }) => {
          const on = path === href || path.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors ${
                on ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent/30" : "text-muted hover:bg-fg/5 hover:text-fg"}`}>
              <Icon size={16} /> {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
