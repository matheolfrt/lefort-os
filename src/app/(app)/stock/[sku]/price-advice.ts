"use server";

import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/session";
import { loadSoldRows } from "@/lib/kpi/load";
import { advisePrice, buildGuide } from "@/lib/kpi/price-guide";

/** « Prix conseillé » of one article, from what the same kind of piece sold for over the last 12 months */
export async function priceAdviceFor(itemId: string): Promise<{ price: number; text: string } | { none: string }> {
  await getContext();
  const supabase = await createClient();
  const { data: it } = await supabase.from("items").select("title, brands(name), categories(name)").eq("id", itemId).maybeSingle();
  if (!it) return { none: "Article introuvable." };
  const pick = (x: unknown) => (Array.isArray(x) ? x[0]?.name : (x as { name?: string } | null)?.name) ?? null;
  try {
    const guide = buildGuide(await loadSoldRows(supabase));
    const a = advisePrice(guide, { title: it.title, brand: pick(it.brands), category: pick(it.categories) }, Date.now());
    return a ? { price: a.price, text: a.text } : { none: "Pas encore assez de ventes de ce type de pièce pour conseiller un prix (il en faut 5)." };
  } catch {
    return { none: "Prix conseillé indisponible pour l'instant." };
  }
}
