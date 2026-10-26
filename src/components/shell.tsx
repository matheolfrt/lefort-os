"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes, Calculator, Factory, LayoutDashboard, MapPin, Package, ScanLine, Settings, ShoppingBag, Truck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useScanApi } from "./scan-provider";

const NAV = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, manager: false },
  { href: "/postes", label: "Postes", icon: Factory, manager: false },
  { href: "/stock", label: "Stock", icon: Package, manager: false },
  { href: "/lots", label: "Lots", icon: Boxes, manager: false },
  { href: "/ventes", label: "Ventes", icon: ShoppingBag, manager: false },
  { href: "/emplacements", label: "Emplacements", icon: MapPin, manager: false },
  { href: "/fournisseurs", label: "Fournisseurs", icon: Truck, manager: true },
  { href: "/compta", label: "Compta & URSSAF", icon: Calculator, manager: true },
  { href: "/parametres", label: "Paramètres", icon: Settings, manager: true },
];

const MOBILE = ["/", "/postes", "/stock", "/ventes"];

export function Shell({ children, isManager, orgName, userName }: {
  children: ReactNode; isManager: boolean; orgName: string; userName: string;
}) {
  const path = usePathname();
  const { openCamera, openQuick } = useScanApi();
  const items = NAV.filter((n) => isManager || !n.manager);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink text-ink-fg md:flex">
        <div className="px-5 py-5">
          <div className="text-lg font-black tracking-tight">LEFORT OS</div>
          <div className="text-xs opacity-60">{orgName}</div>
        </div>
        <div className="px-3 pb-3">
          <button
            onClick={openQuick}
            className="flex w-full items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-left text-sm text-white/70 hover:border-white/30 hover:text-white"
          >
            <ScanLine size={16} /> <span className="flex-1">Scanner un SKU</span>
            <kbd className="rounded border border-white/20 px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${
                active(href) ? "bg-accent text-accent-fg" : "opacity-80 hover:bg-white/10 hover:opacity-100"
              }`}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs opacity-70">
          {userName}
          <form action="/logout" method="post">
            <button className="mt-1 underline">Se déconnecter</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-6">{children}</main>

      {/* Phone: bottom bar with a central scan button */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
        {MOBILE.slice(0, 2).map((href) => <MobileLink key={href} href={href} active={active(href)} />)}
        <button onClick={openCamera} className="-mt-5 flex flex-col items-center" aria-label="Scanner">
          <span className="rounded-full bg-accent p-4 text-accent-fg shadow-lg"><ScanLine size={28} /></span>
        </button>
        {MOBILE.slice(2).map((href) => <MobileLink key={href} href={href} active={active(href)} />)}
      </nav>
    </div>
  );
}

function MobileLink({ href, active }: { href: string; active: boolean }) {
  const item = NAV.find((n) => n.href === href)!;
  const Icon = item.icon;
  return (
    <Link href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
      <Icon size={22} />
      {item.label.split(" ")[0]}
    </Link>
  );
}
