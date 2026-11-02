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
import { Logo } from "@/components/logo";

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
  // a station on a phone: the whole screen for the work (the station has its own scan button and a way back)
  const station = /^\/postes\/(reception|photo|rangement|publication|expedition)(\/|$)/.test(path);
  useEffect(() => setMenu(false), [path]);

  return (
    <div className="min-h-dvh md:flex">
      {/* Computer: the menu floats as a glass pane beside the page */}
      <aside className="sticky top-0 hidden h-dvh w-[17rem] shrink-0 p-3 pr-0 md:flex">
       <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <Logo className="size-9" />
          <span className="min-w-0">
            <span className="block text-[17px] font-bold leading-tight tracking-[-0.02em]">Lefort OS</span>
            <span className="block truncate text-xs text-muted">{orgName}</span>
          </span>
        </div>
        <div className="px-3 pb-3">
          <button
            onClick={openQuick}
            className="flex w-full items-center gap-2 rounded-xl bg-[var(--fill)] px-3 py-2 text-left text-sm text-muted transition hover:bg-[var(--fill-hover)] hover:text-fg"
          >
            <Search size={16} /> <span className="flex-1">Rechercher, scanner…</span>
            <kbd className="rounded-md bg-[var(--fill)] px-1.5 font-sans text-[11px]">⌘K</kbd>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {NAV_GROUPS.map(({ group }) => {
            const links = items.filter((i) => i.group === group);
            if (!links.length) return null;
            return (
              <div key={group} className="mt-4 first:mt-0" data-nav-group={group}>
                <div className="flex items-baseline gap-1.5 px-3 pb-1">
                  <span className="text-[13px] font-semibold text-muted">{group}</span>
                </div>
                <div className="space-y-0.5">
                  {links.map(({ href, label, icon: Icon, match }) => (
                    <Link
                      key={label}
                      href={href}
                      aria-current={active(href, match) ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-[7px] text-[15px] transition-colors duration-150 ${
                        active(href, match) ? "bg-[var(--fill-hover)] font-semibold text-fg" : "text-fg/80 hover:bg-[var(--fill)] hover:text-fg"
                      }`}
                    >
                      <Icon size={18} className={`shrink-0 ${active(href, match) ? "text-accent" : "text-muted group-hover:text-fg"}`} /> <span className="flex-1">{label}</span>
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
            <span title="Raccourcis clavier" className="shrink-0">Raccourcis <kbd className="rounded-md bg-[var(--fill)] px-1.5 font-sans text-[11px]">?</kbd></span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <form action="/logout" method="post">
              <button className="underline">Se déconnecter</button>
            </form>
            <ThemeSwitch initial={theme} compact />
          </div>
        </div>
       </div>
      </aside>

      {/* Phone: top bar with search and the full menu */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--glass-edge)] bg-[var(--glass)] px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-2xl backdrop-saturate-[1.8] md:hidden">
        <Link href="/" className="flex min-h-11 items-center gap-2">
          <Logo className="size-8" />
          <span className="font-bold tracking-[-0.02em]">Lefort OS</span>
        </Link>
        <button onClick={openQuick} aria-label="Rechercher"
          className="ml-auto flex min-h-10 max-w-48 flex-1 items-center gap-2 rounded-full bg-[var(--fill)] px-3.5 text-sm text-muted">
          <Search size={16} /> Rechercher
        </button>
        <button onClick={() => setMenu(true)} aria-label="Menu" aria-expanded={menu}
          className="flex size-11 items-center justify-center rounded-full bg-[var(--fill)]"><Menu size={20} /></button>
      </header>
      {menu && (
        <div className="panel-fade fixed inset-0 z-50 bg-black/35 md:hidden" onClick={() => setMenu(false)}>
          <nav aria-label="Menu" onClick={(e) => e.stopPropagation()}
            className="glass-strong pop-in absolute inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-3xl px-3 pb-4 pt-2">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="eyebrow text-muted">{orgName}</span>
              <button onClick={() => setMenu(false)} aria-label="Fermer" className="flex size-11 items-center justify-center rounded-xl"><X size={20} /></button>
            </div>
            {NAV_GROUPS.map(({ group }) => {
              const links = items.filter((i) => i.group === group);
              if (!links.length) return null;
              return (
                <div key={group} className="mt-3 first:mt-0" data-nav-group={group}>
                  <div className="px-2 pb-1.5 text-[13px] font-semibold text-muted">{group}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {links.map(({ href, label, icon: Icon, match }) => (
                      <Link key={label} href={href} onClick={() => setMenu(false)}
                        className={`flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm font-medium ${
                          active(href, match) ? "bg-[var(--fill-hover)] font-semibold text-fg" : "bg-[var(--fill)] text-fg/85"}`}>
                        <Icon size={18} className={active(href, match) ? "text-accent" : "text-muted"} /> {label}
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

      <main className={`min-w-0 flex-1 px-4 pt-4 md:px-8 md:pb-10 md:pt-6 ${station ? "pb-[max(1.5rem,env(safe-area-inset-bottom))]" : "pb-28"}`}><div key={path} className="page-in mx-auto max-w-7xl"><HubTabs isManager={isManager} />{children}</div></main>

      <KeyboardShortcuts isManager={isManager} />

      {/* Phone: a floating glass tab bar, as on iOS, with the scan button in the middle */}
      <nav className={`glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 h-16 grid-cols-5 items-center rounded-full px-1.5 ${station ? "hidden" : "grid"} md:hidden`} data-bottom-nav>
        {MOBILE.slice(0, 2).map((href) => <MobileLink key={href} href={href} active={active(href)} />)}
        <button onClick={openCamera} className="flex items-center justify-center" aria-label="Scanner">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_6px_16px_-6px_var(--accent)] transition active:scale-95"><ScanLine size={24} /></span>
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
    <Link href={href} className={`relative mx-0.5 flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors ${active ? "bg-[var(--fill-hover)] text-accent" : "text-fg/75"}`}>
      <span className="absolute right-[22%] top-1.5"><Pending /></span>
      <Icon size={21} strokeWidth={active ? 2.3 : 2} />
      {item.label.split(" ")[0]}
    </Link>
  );
}
