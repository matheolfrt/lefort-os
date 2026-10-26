import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CONDITION_LABEL, STATUS_LABEL } from "@/i18n/fr";
import { csvEuros, toCsv, type Cell } from "@/lib/csv";
import type { ItemCondition, ItemStatus } from "@/lib/types";

type Row = {
  id: string; sku: string; status: ItemStatus; size_label: string | null; trouser_size_label: string | null;
  condition: ItemCondition | null; composition: string | null; title: string | null; description: string | null;
  list_price_cents: number | null; min_price_cents: number | null; received_at: string; listed_at: string | null;
  defects: string | null; notes: string | null;
  categories: { name: string } | null; brands: { name: string } | null; locations: { code: string } | null;
  batches: { code: string } | null; color: { value: string } | null; material: { value: string } | null;
  pattern: { value: string } | null; listings: { url: string | null; status: string }[];
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "");

// GET /export/inventaire?q=&status=&category=&deleted=1 — same filters as the Stock list
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const supabase = await createClient();
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("items").select(`id, sku, status, size_label, trouser_size_label, condition, composition, title, description,
      list_price_cents, min_price_cents, received_at, listed_at, defects, notes,
      categories(name), brands(name), locations(code), batches(code),
      color:attribute_values!items_color_id_fkey(value), material:attribute_values!items_material_id_fkey(value),
      pattern:attribute_values!items_pattern_id_fkey(value), listings(url, status)`);
    q = sp.get("deleted") ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
    if (sp.get("status")) q = q.eq("status", sp.get("status")!);
    if (sp.get("category")) q = q.eq("category_id", sp.get("category")!);
    if (sp.get("q")) {
      const s = sp.get("q")!.replace(/[%,()]/g, " ").trim();
      q = q.or(`sku.ilike.%${s}%,title.ilike.%${s}%,size_label.eq.${s}`);
    }
    const { data, error } = await q.order("received_at", { ascending: false }).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows.push(...(data as unknown as Row[]));
    if ((data ?? []).length < 1000) break;
  }

  // Costs are only readable by managers (RLS): the column is left out for others
  const costs = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 300) {
    const { data } = await supabase.from("item_costs").select("item_id, allocated_cost_cents").in("item_id", rows.slice(i, i + 300).map((r) => r.id));
    (data ?? []).forEach((c) => costs.set(c.item_id, c.allocated_cost_cents));
  }
  const withCost = costs.size > 0;

  const header = ["SKU", "Statut", "Catégorie", "Marque", "Taille", "Taille pantalon", "État", "Couleur", "Matière", "Motif",
    "Composition", "Titre", "Description", "Prix", "Prix minimum", "Emplacement", "Lien Vinted", "Lot", "Reçu le",
    "En ligne depuis", "Âge (j)", "Défauts", "Notes", ...(withCost ? ["Coût"] : [])];
  const body: Cell[][] = rows.map((r) => {
    const live = r.listings.find((l) => ["active", "reserved", "sold"].includes(l.status)) ?? r.listings[0];
    return [
      r.sku, STATUS_LABEL[r.status], r.categories?.name, r.brands?.name, r.size_label, r.trouser_size_label,
      r.condition ? CONDITION_LABEL[r.condition] : "", r.color?.value, r.material?.value, r.pattern?.value,
      r.composition, r.title, r.description, csvEuros(r.list_price_cents), csvEuros(r.min_price_cents),
      r.locations?.code, live?.url, r.batches?.code, day(r.received_at), day(r.listed_at),
      Math.floor((Date.now() - new Date(r.received_at).getTime()) / 86_400_000), r.defects, r.notes,
      ...(withCost ? [csvEuros(costs.get(r.id))] : []),
    ];
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv([header, ...body]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventaire-${sp.get("deleted") ? "corbeille-" : ""}${stamp}.csv"`,
    },
  });
}
