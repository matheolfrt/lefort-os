import type { AppRole, HoldReason, ItemCondition, ItemStatus, Station } from "@/lib/types";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  received: "Reçu",
  sorted: "Trié",
  photographed: "Photographié",
  measured: "Mesuré",
  listing_ready: "Prêt à publier",
  listed: "En ligne",
  reserved: "Réservé",
  sold: "Vendu",
  shipped: "Expédié",
  completed: "Terminé",
  on_hold: "En attente",
  rejected: "Écarté",
  returned: "Retourné",
};

/** Production-line order used by the dashboard pipeline */
export const PIPELINE: ItemStatus[] = [
  "received", "sorted", "photographed", "measured", "listing_ready", "listed", "reserved", "sold", "shipped",
];

export const STATUS_TONE: Record<ItemStatus, string> = {
  received: "bg-slate-200 text-slate-900",
  sorted: "bg-sky-200 text-sky-950",
  photographed: "bg-indigo-200 text-indigo-950",
  measured: "bg-violet-200 text-violet-950",
  listing_ready: "bg-amber-200 text-amber-950",
  listed: "bg-emerald-200 text-emerald-950",
  reserved: "bg-teal-200 text-teal-950",
  sold: "bg-orange-300 text-orange-950",
  shipped: "bg-lime-200 text-lime-950",
  completed: "bg-zinc-300 text-zinc-800",
  on_hold: "bg-yellow-300 text-yellow-950",
  rejected: "bg-red-200 text-red-950",
  returned: "bg-rose-300 text-rose-950",
};

export const CONDITION_LABEL: Record<ItemCondition, string> = {
  new_with_tags: "Neuf avec étiquette",
  new_without_tags: "Neuf sans étiquette",
  very_good: "Très bon état",
  good: "Bon état",
  satisfactory: "Satisfaisant",
};

export const HOLD_LABEL: Record<HoldReason, string> = {
  repair: "Retouche",
  cleaning: "Nettoyage",
  research: "Recherche (marque, valeur)",
  other: "Autre",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrateur",
  manager: "Responsable",
  operator: "Opérateur",
  reception: "Réception",
  photographer: "Photographe",
  listing_operator: "Publication",
  warehouse: "Entrepôt",
  shipping: "Expédition",
};

export const STATION_LABEL: Record<Station, string> = {
  sort: "Réception & tri",
  photo: "Photo",
  measure: "Mesures",
  photo_measure: "Photo & mesures",
  storage: "Rangement",
  listing: "Publication",
  shipping: "Expédition",
};
