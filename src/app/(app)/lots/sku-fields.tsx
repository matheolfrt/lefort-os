"use client";

import { useEffect, useRef, useState } from "react";
import { input } from "@/components/ui";

/** SKU numbering chosen for a batch: prefix + consecutive numbers (M-1 … M-37). Plain form fields with a live preview. */
export function SkuFields({ defaultCount = 0, defaultPrefix = "", optional = false }: { defaultCount?: number; defaultPrefix?: string; optional?: boolean }) {
  const [on, setOn] = useState(!optional);
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(defaultCount || 10);
  // on the new-batch form, the count follows "Nombre d'articles attendu" until it is edited here
  const edited = useRef(false);
  useEffect(() => {
    const el = document.querySelector<HTMLInputElement>('input[name="expected_qty"]');
    if (!el) return;
    const sync = () => { if (!edited.current && Number(el.value) > 0) setCount(Number(el.value)); };
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, []);
  const p = prefix.toUpperCase().trim();
  const valid = /^[A-Z]{1,6}-?$/.test(p) && count >= 1 && count <= 1000 && start >= 0;

  return (
    <div className="space-y-3">
      {optional && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" name="sku_custom" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-5 accent-[var(--accent)]" />
          <span className="text-sm font-medium">Choisir mes propres SKU <span className="block text-xs font-normal text-muted">Sinon : numérotation automatique au moment de la réception</span></span>
        </label>
      )}
      {on && (
        <>
          {!optional && <input type="hidden" name="sku_custom" value="on" />}
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="eyebrow-tight mb-1.5 block text-muted">Préfixe</span>
              <input className={`${input} font-mono uppercase`} name="sku_prefix" value={prefix} placeholder="M-" maxLength={7} required
                onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
            </label>
            <label className="block">
              <span className="eyebrow-tight mb-1.5 block text-muted">Premier n°</span>
              <input className={`${input} font-mono`} name="sku_start" type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} required />
            </label>
            <label className="block">
              <span className="eyebrow-tight mb-1.5 block text-muted">Articles</span>
              <input className={`${input} font-mono`} name="sku_count" type="number" min={1} max={1000} value={count} onChange={(e) => { edited.current = true; setCount(Number(e.target.value)); }} required />
            </label>
          </div>
          <p className={`rounded-xl px-3 py-2 font-mono text-sm ring-1 ring-inset ${valid ? "bg-accent/10 text-accent ring-accent/25" : "bg-red-500/10 text-red-200 ring-red-400/30"}`}>
            {valid ? `${p}${start} → ${p}${start + count - 1} · ${count} SKU` : "Préfixe : 1 à 6 lettres, tiret facultatif (M-, BLZ, COST-)"}
          </p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" name="sku_items" defaultChecked className="mt-0.5 size-5 accent-[var(--accent)]" />
            <span className="text-sm">Créer les articles dans le stock maintenant
              <span className="block text-xs text-muted">Ils apparaissent « Reçu » ; au poste Réception, scanner ou taper le SKU complète l&apos;article.</span></span>
          </label>
        </>
      )}
    </div>
  );
}
