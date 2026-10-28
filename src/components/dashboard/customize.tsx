"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, SlidersHorizontal, X } from "lucide-react";
import { setDashLayout } from "@/app/prefs-actions";
import { btn } from "@/components/ui";

interface Card { id: string; label: string; hint: string }

/** Show, hide and reorder the dashboard cards. Saved on this device; « Par défaut » puts everything back */
export function DashboardCustomize({ cards, hidden: initialHidden }: { cards: Card[]; hidden: string[] }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(cards);
  const [hidden, setHidden] = useState(new Set(initialHidden));
  const [, start] = useTransition();
  const router = useRouter();

  const save = (o: Card[], h: Set<string>) => {
    setOrder(o); setHidden(h);
    start(async () => { await setDashLayout({ order: o.map((c) => c.id), hidden: [...h] }); router.refresh(); });
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order]; [o[i], o[j]] = [o[j], o[i]];
    save(o, hidden);
  };
  const toggle = (id: string) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id); else h.add(id);
    save(order, h);
  };
  const reset = () => start(async () => { await setDashLayout(null); setOpen(false); router.refresh(); });

  return (
    <div className="relative max-sm:order-2 max-sm:ml-auto">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="customize"
        className={`${btn.secondary} max-sm:min-h-10 max-sm:px-3 max-sm:text-sm`}>
        <SlidersHorizontal size={16} /> Personnaliser
      </button>
      {open && (
        <div role="dialog" aria-label="Personnaliser le tableau de bord"
          className="pop-in absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] max-h-[75dvh] overflow-y-auto rounded-2xl border border-line bg-panel p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <span className="text-sm font-semibold">Cartes du tableau de bord</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="flex size-9 items-center justify-center rounded-lg text-muted hover:text-fg"><X size={18} /></button>
          </div>
          <p className="mb-2 px-1 text-xs text-muted">Les alertes urgentes restent toujours en haut. Réglage gardé sur cet appareil.</p>
          <ol className="space-y-1">
            {order.map((c, i) => {
              const off = hidden.has(c.id);
              return (
                <li key={c.id} data-card={c.id} className={`flex items-center gap-1 rounded-xl border border-line px-2 py-1.5 transition-opacity ${off ? "opacity-55" : ""}`}>
                  <span className="min-w-0 flex-1 pl-1">
                    <span className="block truncate text-sm font-medium">{c.label}</span>
                    <span className="block truncate text-[11px] text-muted">{off ? "masquée" : c.hint}</span>
                  </span>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter ${c.label}`}
                    className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-fg/5 hover:text-fg disabled:opacity-30"><ArrowUp size={16} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Descendre ${c.label}`}
                    className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-fg/5 hover:text-fg disabled:opacity-30"><ArrowDown size={16} /></button>
                  <button type="button" onClick={() => toggle(c.id)} aria-pressed={!off} aria-label={off ? `Afficher ${c.label}` : `Masquer ${c.label}`}
                    className={`flex size-9 items-center justify-center rounded-lg hover:bg-fg/5 ${off ? "text-muted" : "text-accent"}`}>
                    {off ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={reset} className="mt-2 inline-flex min-h-10 items-center px-1 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">
            Revenir à l&apos;ordre par défaut
          </button>
        </div>
      )}
    </div>
  );
}
