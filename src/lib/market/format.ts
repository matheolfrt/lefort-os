import type { MarketQuery } from "./collect";

/** The filters of a search, in words */
export const filters = (q: MarketQuery) => [
  q.search_text && `« ${q.search_text} »`, q.catalog_ids?.length && `${q.catalog_ids.length} catégorie${q.catalog_ids.length > 1 ? "s" : ""}`,
  q.brand_ids?.length && `${q.brand_ids.length} marque${q.brand_ids.length > 1 ? "s" : ""}`, q.size_ids?.length && `${q.size_ids.length} taille${q.size_ids.length > 1 ? "s" : ""}`,
  q.price_from && `dès ${q.price_from} €`, q.price_to && `jusqu'à ${q.price_to} €`,
].filter(Boolean).join(" · ");

/** 3 j 11 h, 17 h, 45 min */
export function duration(hours: number | null | undefined) {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${Math.round(hours)} h`;
  const d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
  return h ? `${d} j ${h} h` : `${d} j`;
}
export const eurC = (c: number | null | undefined, digits = 0) =>
  c == null ? "—" : (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits });
