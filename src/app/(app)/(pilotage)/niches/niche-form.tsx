"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Field, btn, input } from "@/components/ui";
import { eurosInput } from "@/lib/format";
import type { Niche } from "@/lib/niches";
import { saveNiche } from "./actions";

type Option = { id: string; name: string };

/** Name, hypothesis, criteria and targets of a niche */
export function NicheForm({ niche, brands, categories }: { niche: Niche | null; brands: Option[]; categories: Option[] }) {
  const [brandIds, setBrandIds] = useState<string[]>(niche?.brand_ids ?? []);
  const [search, setSearch] = useState("");
  const byId = useMemo(() => new Map(brands.map((b) => [b.id, b.name])), [brands]);
  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return brands.filter((b) => b.name.toLowerCase().includes(q) && !brandIds.includes(b.id)).slice(0, 8);
  }, [search, brands, brandIds]);

  return (
    <form action={saveNiche} className="grid gap-4 md:grid-cols-2">
      {niche && <input type="hidden" name="id" value={niche.id} />}
      {brandIds.map((id) => <input key={id} type="hidden" name="brand_ids" value={id} />)}

      <div className="space-y-3 md:col-span-2">
        <Field label="Nom de la niche"><input className={input} name="name" required maxLength={80} defaultValue={niche?.name} placeholder="Ex. : Vestes en tweed" /></Field>
        <Field label="Hypothèse" hint="Pourquoi cette niche pourrait marcher : vous la relirez au moment de décider.">
          <textarea className={`${input} min-h-20 py-2`} name="hypothesis" defaultValue={niche?.hypothesis ?? ""} placeholder="Ex. : peu d'offre en grandes tailles, les acheteurs négocient peu…" />
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-2xl border border-line p-4">
        <legend className="eyebrow-tight px-1 text-muted">Articles concernés</legend>
        <p className="text-xs text-muted">Un article fait partie de la niche s&apos;il remplit tous les critères renseignés. Les articles des lots rattachés à la niche comptent toujours.</p>
        <div>
          <span className="eyebrow-tight mb-1.5 block text-muted">Marques</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {brandIds.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-panel-2 py-1 pl-3 pr-1 text-sm">
                {byId.get(id) ?? "?"}
                <button type="button" aria-label={`Retirer ${byId.get(id)}`} onClick={() => setBrandIds((b) => b.filter((x) => x !== id))}
                  className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-line hover:text-fg"><X size={13} /></button>
              </span>
            ))}
          </div>
          <div className="relative">
            <input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ajouter une marque…" aria-label="Ajouter une marque"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (hits[0]) { setBrandIds((b) => [...b, hits[0].id]); setSearch(""); } } }} />
            {hits.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
                {hits.map((b) => (
                  <li key={b.id}>
                    <button type="button" className="block min-h-10 w-full px-3 text-left text-sm hover:bg-panel-2"
                      onClick={() => { setBrandIds((x) => [...x, b.id]); setSearch(""); }}>{b.name}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <span className="eyebrow-tight mb-1.5 block text-muted">Catégories</span>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <label key={c.id} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/10">
                <input type="checkbox" name="category_ids" value={c.id} defaultChecked={niche?.category_ids.includes(c.id)} className="accent-[var(--accent)]" />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <Field label="Tailles" hint="Séparées par des virgules : 56, 58, XXL">
          <input className={input} name="sizes" defaultValue={niche?.sizes.join(", ")} />
        </Field>
        <Field label="Mots-clés dans le titre ou la marque" hint="Séparés par des virgules : tweed, harris, cachemire">
          <input className={input} name="keywords" defaultValue={niche?.keywords.join(", ")} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Prix de vente min (€)"><input className={input} name="price_min" inputMode="decimal" defaultValue={eurosInput(niche?.price_min_cents)} /></Field>
          <Field label="Prix de vente max (€)"><input className={input} name="price_max" inputMode="decimal" defaultValue={eurosInput(niche?.price_max_cents)} /></Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-2xl border border-line p-4">
        <legend className="eyebrow-tight px-1 text-muted">Objectifs du test</legend>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Prix d'achat visé / article (€)"><input className={input} name="target_buy" inputMode="decimal" defaultValue={eurosInput(niche?.target_buy_cents)} /></Field>
          <Field label="Prix de revente visé (€)"><input className={input} name="target_sell" inputMode="decimal" defaultValue={eurosInput(niche?.target_sell_cents)} /></Field>
          <Field label="Budget du test (€)"><input className={input} name="budget" inputMode="decimal" defaultValue={eurosInput(niche?.budget_cents)} /></Field>
          <Field label="Ventes avant de décider"><input className={input} name="test_items" type="number" min={1} inputMode="numeric" defaultValue={niche?.test_items ?? ""} placeholder="5" /></Field>
        </div>
        <p className="text-xs text-muted">Le verdict attend ce nombre de ventes (5 par défaut) avant de dire si la niche est rentable.</p>
      </fieldset>

      <button className={`${btn.primary} md:col-span-2`}>{niche ? "Enregistrer" : "Créer la niche"}</button>
    </form>
  );
}
