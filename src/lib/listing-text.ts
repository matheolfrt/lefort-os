import { CONDITION_LABEL } from "@/i18n/fr";
import type { Catalog, Item } from "@/lib/types";
import { cm } from "@/lib/format";

/** Deterministic Vinted title/description from item data (AI suggestions will plug in here later). */
export function buildListingText(
  item: Item,
  catalog: Catalog,
  measurements: Record<string, number>,
  signature: string,
): { title: string; description: string } {
  const cat = catalog.categories.find((c) => c.id === item.category_id);
  const brand = catalog.brands.find((b) => b.id === item.brand_id);
  const attr = (id: string | null) => catalog.attributes.find((a) => a.id === id)?.value;
  const brandName = brand && brand.name !== "Sans marque" ? brand.name : null;
  const color = attr(item.color_id);
  const pattern = attr(item.pattern_id);
  const material = attr(item.material_id);

  const title = [
    cat?.name,
    brandName,
    material?.toLowerCase(),
    color?.toLowerCase(),
    pattern && pattern !== "Uni" ? pattern.toLowerCase() : null,
    item.size_label ? `T${item.size_label}` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 90);

  const defs = catalog.definitions
    .filter((d) => d.template_id === cat?.measurement_template_id && measurements[d.id])
    .sort((a, b) => a.sort - b.sort);

  const lines = [
    `${cat?.name ?? "Article"}${brandName ? ` ${brandName}` : ""}`,
    "",
    item.size_label && `Taille : ${item.size_label}${item.trouser_size_label ? ` (pantalon ${item.trouser_size_label})` : ""}`,
    item.condition && `État : ${CONDITION_LABEL[item.condition]}`,
    color && `Couleur : ${color}${pattern && pattern !== "Uni" ? `, ${pattern.toLowerCase()}` : ""}`,
    (item.composition || material) && `Matière : ${item.composition || material}`,
    item.defects && `Défauts : ${item.defects}`,
    defs.length > 0 && "",
    defs.length > 0 && "Mesures à plat :",
    ...defs.map((d) => `• ${d.label} : ${cm(measurements[d.id])}`),
    "",
    signature,
    `Réf. ${item.sku}`,
  ];
  return { title, description: lines.filter((l) => l !== false && l !== null && l !== undefined).join("\n") };
}
