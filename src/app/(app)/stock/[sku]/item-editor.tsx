"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandPicker } from "@/components/brand-picker";
import { Field, btn, input } from "@/components/ui";
import { CONDITION_LABEL } from "@/i18n/fr";
import { eurosInput, parseEuros } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Brand, Catalog, Item, ItemCondition } from "@/lib/types";

export function ItemEditor({ item, catalog, orgId, locked }: { item: Item; catalog: Catalog; orgId: string; locked: boolean }) {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>(catalog.brands);
  const [f, setF] = useState({
    category_id: item.category_id, brand_id: item.brand_id, size_label: item.size_label ?? "",
    trouser_size_label: item.trouser_size_label ?? "", condition: item.condition, color_id: item.color_id,
    pattern_id: item.pattern_id, material_id: item.material_id, composition: item.composition ?? "",
    defects: item.defects ?? "", notes: item.notes ?? "", title: item.title ?? "", description: item.description ?? "",
    list_price: eurosInput(item.list_price_cents), min_price: eurosInput(item.min_price_cents),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | null) => setF((x) => ({ ...x, [k]: v }));
  const attrs = (kind: string) => catalog.attributes.filter((a) => a.kind === kind);

  async function save() {
    const { error } = await supabaseBrowser().from("items").update({
      category_id: f.category_id, brand_id: f.brand_id, size_label: f.size_label || null,
      trouser_size_label: f.trouser_size_label || null, condition: f.condition, color_id: f.color_id,
      pattern_id: f.pattern_id, material_id: f.material_id, composition: f.composition || null,
      defects: f.defects || null, notes: f.notes || null, title: f.title || null, description: f.description || null,
      list_price_cents: parseEuros(f.list_price) || null, min_price_cents: parseEuros(f.min_price) || null,
    }).eq("id", item.id);
    setMsg(error ? errorMessage(error) : "Enregistré");
    if (!error) router.refresh();
  }

  const select = (k: "color_id" | "pattern_id" | "material_id", kind: string, label: string) => (
    <Field label={label}>
      <select className={input} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value || null)} disabled={locked}>
        <option value="">—</option>
        {attrs(kind).map((a) => <option key={a.id} value={a.id}>{a.value}</option>)}
      </select>
    </Field>
  );

  return (
    <fieldset disabled={locked} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Catégorie">
          <select className={input} value={f.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)}>
            <option value="">—</option>
            {catalog.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Marque">
          <BrandPicker brands={brands} value={f.brand_id} onChange={(id) => set("brand_id", id)} orgId={orgId} onCreated={(b) => setBrands((x) => [...x, b])} />
        </Field>
        <Field label="État">
          <select className={input} value={f.condition ?? ""} onChange={(e) => set("condition", (e.target.value || null) as ItemCondition | null)}>
            <option value="">—</option>
            {Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Taille"><input className={input} value={f.size_label} onChange={(e) => set("size_label", e.target.value)} /></Field>
        <Field label="Taille pantalon"><input className={input} value={f.trouser_size_label} onChange={(e) => set("trouser_size_label", e.target.value)} /></Field>
        {select("color_id", "color", "Couleur")}
        {select("pattern_id", "pattern", "Motif")}
        {select("material_id", "material", "Matière")}
        <Field label="Composition (étiquette)"><input className={input} value={f.composition} onChange={(e) => set("composition", e.target.value)} placeholder="100 % laine vierge" /></Field>
        <Field label="Prix affiché (€)"><input className={input} inputMode="decimal" value={f.list_price} onChange={(e) => set("list_price", e.target.value)} /></Field>
        <Field label="Prix minimum (€)"><input className={input} inputMode="decimal" value={f.min_price} onChange={(e) => set("min_price", e.target.value)} /></Field>
      </div>
      <Field label="Défauts"><input className={input} value={f.defects} onChange={(e) => set("defects", e.target.value)} /></Field>
      <Field label="Titre"><input className={input} value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
      <Field label="Description"><textarea className={`${input} min-h-32 py-2`} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Notes internes"><textarea className={`${input} min-h-16 py-2`} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div className="flex items-center gap-3">
        <button type="button" className={btn.primary} onClick={save}>Enregistrer</button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </fieldset>
  );
}
