import { CONDITION_LABEL, STATUS_LABEL } from "@/i18n/fr";
import type { ItemCondition, ItemStatus } from "@/lib/types";

// Column names shared by exports and imports, so an exported file can be edited and imported back.
export const INVENTORY_ALIASES: Record<string, string[]> = {
  sku: ["ref", "reference_article"],
  category: ["categorie"],
  brand: ["marque"],
  size: ["taille"],
  condition: ["etat"],
  color: ["couleur"],
  material: ["matiere"],
  pattern: ["motif"],
  title: ["titre"],
  description: [],
  price: ["prix", "prix_affiche", "prix_de_vente"],
  min_price: ["prix_minimum", "prix_min"],
  status: ["statut"],
  location: ["emplacement"],
  vinted_url: ["lien_vinted", "lien", "url"],
  cost: ["cout", "cout_de_revient", "cout_d_achat", "prix_d_achat"],
};

export const SALES_ALIASES: Record<string, string[]> = {
  sku: ["ref", "reference_article"],
  price: ["prix", "prix_de_vente", "montant"],
  sold_at: ["date", "date_de_vente", "date_vente"],
  paid_at: ["date_d_encaissement", "date_encaissement", "encaisse_le"],
  buyer: ["acheteur", "client"],
  order_ref: ["ref_commande", "reference_commande", "commande", "id_transaction"],
  order_number: ["n_commande", "no_commande", "numero_commande"],
  shipping: ["frais_de_port", "frais_port", "port"],
  packaging: ["emballage"],
  platform_fee: ["frais_plateforme", "frais_vinted", "frais_de_protection"],
  // used only to create items that were never in the stock
  title: ["titre", "article"],
  brand: ["marque"],
  size: ["taille"],
  category: ["categorie"],
  condition: ["etat"],
  cost: ["cout", "cout_de_revient", "cout_d_achat", "prix_d_achat"],
  vinted_url: ["lien_vinted", "lien", "url"],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "Très bon état" / "tres bon etat" / "very_good" → very_good */
export function conditionCode(v: string | undefined): ItemCondition | null | "invalid" {
  if (!v?.trim()) return null;
  const n = norm(v);
  for (const [code, label] of Object.entries(CONDITION_LABEL)) if (n === norm(label) || n === code) return code as ItemCondition;
  return "invalid";
}

/** Statuses accepted when creating items by import */
export function importStatusCode(v: string | undefined): "received" | "listing_ready" | "listed" | null | "invalid" {
  if (!v?.trim()) return null;
  const n = norm(v);
  for (const code of ["received", "listing_ready", "listed"] as const) {
    if (n === code || n === norm(STATUS_LABEL[code as ItemStatus])) return code;
  }
  return "invalid";
}
