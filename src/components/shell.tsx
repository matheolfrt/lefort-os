"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ScanLine, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NAV, NAV_GROUPS, menuItems } from "@/lib/nav";
import { HubTabs } from "./hub-tabs";
import { useScanApi } from "./scan-provider";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { ThemeSwitch } from "./theme-switch";
import type { Theme } from "@/lib/prefs";

const MOBILE = ["/", "/postes", "/stock", "/ventes"];

/** A small pulse on the link being opened, until the page is there */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`size-1.5 rounded-full bg-accent transition-opacity duration-200 ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} />;
}

export function Shell({ children, isManager, orgName, userName, theme }: {
  children: ReactNode; isManager: boolean; orgName: string; userName: string; theme: Theme;
}) {
  const path = usePathname();
  const { openCamera, openQuick } = useScanApi();
  const items = menuItems(isManager);
  const under = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const active = (href: string, match?: string[]) => (match ? match.some(under) : under(href));
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
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {NAV_GROUPS.map(({ group, hint }) => {
            const links = items.filter((i) => i.group === group);
            if (!links.length) return null;
            return (
              <div key={group} className="mt-4 first:mt-0" data-nav-group={group}>
                <div className="flex items-baseline gap-1.5 px-3 pb-1.5">
                  <span className="eyebrow-tight text-[10px] text-muted/80">{group}</span>
                  {hint && <span className="text-[11px] text-muted/50">· {hint}</span>}
                </div>
                <div className="space-y-0.5">
                  {links.map(({ href, label, icon: Icon, match }) => (
                    <Link
                      key={label}
                      href={href}
                      aria-current={active(href, match) ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                        active(href, match) ? "bg-accent/12 text-accent" : "text-fg/70 hover:bg-fg/5 hover:text-fg"
                      }`}
                    >
                      {active(href, match) && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />}
                      <Icon size={18} className="shrink-0" /> <span className="flex-1">{label}</span>
                      <Pending />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-line px-5 py-4 text-xs text-muted">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{userName}</span>
            <span title="Raccourcis clavier" className="shrink-0">Raccourcis <kbd className="rounded-md border border-line px-1.5 font-mono text-[10px]">?</kbd></span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <form action="/logout" method="post">
              <button className="underline">Se déconnecter</button>
            </form>
            <ThemeSwitch initial={theme} compact />
          </div>
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
            {NAV_GROUPS.map(({ group, hint }) => {
              const links = items.filter((i) => i.group === group);
              if (!links.length) return null;
              return (
                <div key={group} className="mt-3 first:mt-0" data-nav-group={group}>
                  <div className="px-2 pb-1.5 text-xs font-semibold text-muted">{group}{hint && <span className="font-normal text-muted/60"> · {hint}</span>}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {links.map(({ href, label, icon: Icon, match }) => (
                      <Link key={label} href={href} onClick={() => setMenu(false)}
                        className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
                          active(href, match) ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25" : "bg-bg/60 text-fg/85"}`}>
                        <Icon size={18} /> {label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line px-2 pt-3 text-sm text-muted">
              <span>Thème</span>
              <ThemeSwitch initial={theme} />
            </div>
            <div className="mt-2 flex items-center justify-between px-2 text-sm text-muted">
              {userName}
              <form action="/logout" method="post"><button className="min-h-11 underline">Se déconnecter</button></form>
            </div>
          </nav>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-6"><div key={path} className="page-in mx-auto max-w-7xl"><HubTabs isManager={isManager} />{children}</div></main>

      <KeyboardShortcuts isManager={isManager} />

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
    <Link href={href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${active ? "text-accent" : "text-muted"}`}>
      <span className="absolute right-[30%] top-1.5"><Pending /></span>
      <Icon size={22} />
      {item.label.split(" ")[0]}
    </Link>
  );
}
