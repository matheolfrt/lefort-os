import { createClient } from "@/lib/supabase/server";
import type { Catalog } from "@/lib/types";

/** Reference data needed by stations and item forms (small: loaded in one round-trip batch) */
export async function loadCatalog(): Promise<Catalog> {
  const supabase = await createClient();
  const [categories, brands, attributes, definitions, shotLists] = await Promise.all([
    supabase.from("categories").select("*").eq("active", true).order("hotkey", { nullsFirst: false }).order("name"),
    supabase.from("brands").select("id, name, tier").order("name"),
    supabase.from("attribute_values").select("*").order("sort"),
    supabase.from("measurement_definitions").select("*").order("sort"),
    supabase.from("shot_lists").select("*"),
  ]);
  return {
    categories: categories.data ?? [],
    brands: brands.data ?? [],
    attributes: attributes.data ?? [],
    definitions: definitions.data ?? [],
    shotLists: shotLists.data ?? [],
  };
}
