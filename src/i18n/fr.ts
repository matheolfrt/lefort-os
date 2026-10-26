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

// Pills on the dark surface: tinted fill, light text, thin ring
export const STATUS_TONE: Record<ItemStatus, string> = {
  received: "bg-slate-400/15 text-slate-200 ring-1 ring-inset ring-slate-400/30",
  sorted: "bg-sky-400/15 text-sky-200 ring-1 ring-inset ring-sky-400/30",
  photographed: "bg-indigo-400/15 text-indigo-200 ring-1 ring-inset ring-indigo-400/30",
  measured: "bg-violet-400/15 text-violet-200 ring-1 ring-inset ring-violet-400/30",
  listing_ready: "bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-400/30",
  listed: "bg-emerald-400/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/30",
  reserved: "bg-teal-400/15 text-teal-200 ring-1 ring-inset ring-teal-400/30",
  sold: "bg-orange-400/15 text-orange-200 ring-1 ring-inset ring-orange-400/30",
  shipped: "bg-lime-400/15 text-lime-200 ring-1 ring-inset ring-lime-400/30",
  completed: "bg-zinc-400/15 text-zinc-300 ring-1 ring-inset ring-zinc-400/30",
  on_hold: "bg-yellow-400/15 text-yellow-200 ring-1 ring-inset ring-yellow-400/30",
  rejected: "bg-red-400/15 text-red-200 ring-1 ring-inset ring-red-400/30",
  returned: "bg-rose-400/15 text-rose-200 ring-1 ring-inset ring-rose-400/30",
};

/** Solid colour of each status, for dots */
export const STATUS_DOT: Record<ItemStatus, string> = {
  received: "bg-slate-400",
  sorted: "bg-sky-400",
  photographed: "bg-indigo-400",
  measured: "bg-violet-400",
  listing_ready: "bg-amber-400",
  listed: "bg-emerald-400",
  reserved: "bg-teal-400",
  sold: "bg-orange-400",
  shipped: "bg-lime-400",
  completed: "bg-zinc-400",
  on_hold: "bg-yellow-400",
  rejected: "bg-red-400",
  returned: "bg-rose-400",
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
