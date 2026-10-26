"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ScanLine, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NAV } from "@/lib/nav";
import { useScanApi } from "./scan-provider";

const MOBILE = ["/", "/postes", "/stock", "/ventes"];

export function Shell({ children, isManager, orgName, userName }: {
  children: ReactNode; isManager: boolean; orgName: string; userName: string;
}) {
  const path = usePathname();
  const { openCamera, openQuick } = useScanApi();
  const items = NAV.filter((n) => isManager || !n.manager);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-ink/60 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent font-mono text-lg font-bold text-accent-fg shadow-[0_0_24px_-6px_var(--accent)]">L</span>
          <span className="min-w-0">
            <span className="block text-[17px] font-bold leading-tight tracking-[-0.02em]">Lefort OS</span>
            <span className="block truncate text-xs text-muted">{orgName}</span>
          </span>
        </div>
        <div className="px-3 pb-3">
          <button
            onClick={openQuick}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-panel/70 px-3 py-2.5 text-left text-sm text-muted transition hover:border-fg/20 hover:text-fg"
          >
            <Search size={16} /> <span className="flex-1">Rechercher, scanner…</span>
            <kbd className="rounded-md border border-line px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active(href) ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25" : "text-fg/75 hover:bg-fg/5 hover:text-fg"
              }`}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line px-5 py-4 text-xs text-muted">
          {userName}
          <form action="/logout" method="post">
            <button className="mt-1 underline">Se déconnecter</button>
          </form>
        </div>
      </aside>

      {/* Phone: top bar with search and the full menu */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-ink/85 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl md:hidden">
        <Link href="/" className="flex min-h-11 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent font-mono font-bold text-accent-fg">L</span>
          <span className="font-bold tracking-[-0.02em]">Lefort OS</span>
        </Link>
        <button onClick={openQuick} aria-label="Rechercher"
          className="ml-auto flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-panel/70 px-3 text-sm text-muted max-w-48">
          <Search size={16} /> Rechercher
        </button>
        <button onClick={() => setMenu(true)} aria-label="Menu" aria-expanded={menu}
          className="flex size-11 items-center justify-center rounded-xl border border-line bg-panel/70"><Menu size={20} /></button>
      </header>
      {menu && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setMenu(false)}>
          <nav aria-label="Menu" onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 top-0 max-h-dvh overflow-y-auto rounded-b-2xl border-b border-line bg-panel px-3 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="eyebrow text-muted">{orgName}</span>
              <button onClick={() => setMenu(false)} aria-label="Fermer" className="flex size-11 items-center justify-center rounded-xl"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} onClick={() => setMenu(false)}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
                    active(href) ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25" : "bg-bg/60 text-fg/85"}`}>
                  <Icon size={18} /> {label}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line px-2 pt-3 text-sm text-muted">
              {userName}
              <form action="/logout" method="post"><button className="min-h-11 underline">Se déconnecter</button></form>
            </div>
          </nav>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-6"><div className="mx-auto max-w-7xl">{children}</div></main>

      {/* Phone: bottom bar with a central scan button */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-ink/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {MOBILE.slice(0, 2).map((href) => <MobileLink key={href} href={href} active={active(href)} />)}
        <button onClick={openCamera} className="-mt-5 flex flex-col items-center" aria-label="Scanner">
          <span className="rounded-full bg-accent p-4 text-accent-fg shadow-[0_0_28px_-4px_var(--accent)] ring-4 ring-bg"><ScanLine size={28} /></span>
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
