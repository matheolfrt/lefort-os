"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

// Keyboard shortcuts for the computer: « g » then a letter to go somewhere, « n » for a new sale, « ? » for the list.
// A barcode scanner types like a keyboard, only much faster: a key that comes within a few milliseconds of the
// previous one is part of a scan and never triggers a shortcut.

const GO: { key: string; href: string; label: string; manager?: boolean }[] = [
  { key: "d", href: "/", label: "Tableau de bord" },
  { key: "p", href: "/conseils", label: "Conseils", manager: true },
  { key: "f", href: "/finance", label: "Mon argent", manager: true },
  { key: "t", href: "/taches", label: "Tâches" },
  { key: "r", href: "/postes/production", label: "Production" },
  { key: "o", href: "/postes", label: "Postes" },
  { key: "s", href: "/stock", label: "Stock" },
  { key: "l", href: "/lots", label: "Lots" },
  { key: "v", href: "/ventes", label: "Ventes" },
  { key: "e", href: "/emplacements", label: "Emplacements" },
];

const BURST_MS = 35; // closer keys come from a scanner
const SETTLE_MS = 60; // wait that long to be sure a scan is not starting
const CHORD_MS = 1500; // time allowed between « g » and its letter

const typingIn = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function KeyboardShortcuts({ isManager }: { isManager: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [help, setHelp] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;
  const go = GO.filter((g) => isManager || !g.manager);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let last = 0;
    let chordAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const newSale = () => {
      const field = document.querySelector<HTMLInputElement>("[data-new-sale-sku]");
      if (pathRef.current === "/ventes" && field) { field.focus(); field.scrollIntoView({ block: "center" }); return; }
      router.push("/ventes?nouvelle=1");
    };

    const onKey = (e: KeyboardEvent) => {
      // scanners and people both press Shift for capitals and « ? »: it is not a key of its own
      if (e.key === "Shift") return;
      const now = performance.now();
      const gap = now - last;
      last = now;
      clearTimeout(timer);
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typingIn(e.target) || document.querySelector("[role=dialog][aria-modal=true]:not([data-shortcuts])")) {
        chordAt = 0;
        return;
      }
      if (gap < BURST_MS) { chordAt = 0; return; }

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let action: (() => void) | null = null;
      if (chordAt && now - chordAt < CHORD_MS) {
        chordAt = 0;
        const target = goRef.current.find((g) => g.key === key);
        if (target) action = () => router.push(target.href);
      } else if (key === "g") {
        chordAt = now;
        return;
      } else if (key === "n") {
        action = newSale;
      } else if (e.key === "?") {
        action = () => setHelp((h) => !h);
      }
      if (!action) return;
      e.preventDefault();
      const run = action;
      timer = setTimeout(() => { if (performance.now() - last >= SETTLE_MS - 5) run(); }, SETTLE_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [router]);

  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHelp(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);
  useEffect(() => setHelp(false), [path]);

  if (!help) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4" onClick={() => setHelp(false)}>
      <div role="dialog" aria-modal="true" aria-label="Raccourcis clavier" data-shortcuts
        className="pop-in w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Raccourcis clavier</h2>
          <button type="button" aria-label="Fermer" onClick={() => setHelp(false)} className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-fg"><X size={18} /></button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <Row keys={["⌘", "K"]} label="Rechercher, scanner, ou taper une action (« M-12 29 », « vendre M-12 »)" />
          <Row keys={["/"]} label="Rechercher" />
          <Row keys={["N"]} label="Nouvelle vente" />
          {go.map((g) => <Row key={g.key} keys={["G", g.key.toUpperCase()]} label={g.label} />)}
          <Row keys={["?"]} label="Afficher cette aide" />
        </dl>
        <p className="mt-4 text-xs text-muted">Les raccourcis sont ignorés pendant la saisie dans un champ et pendant un scan.</p>
      </div>
    </div>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <>
      <dt className="flex gap-1">{keys.map((k, i) => <kbd key={i} className="min-w-7 rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-center font-mono text-xs">{k}</kbd>)}</dt>
      <dd className="text-fg/80">{label}</dd>
    </>
  );
}
