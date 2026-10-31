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
// One family of colours per kind of state, the same as in the 3D warehouse (src/lib/warehouse3d/config.ts):
// violet = in the workshop, green = available, yellow = reserved, blue = sold, grey = done, red = needs action.
// The words always say which step it is; the shade only follows the order of the steps.
export const STATUS_TONE: Record<ItemStatus, string> = {
  received: "bg-violet-400/15 text-violet-200 ring-1 ring-inset ring-violet-400/30",
  sorted: "bg-violet-400/15 text-violet-200 ring-1 ring-inset ring-violet-400/30",
  photographed: "bg-violet-400/15 text-violet-200 ring-1 ring-inset ring-violet-400/30",
  measured: "bg-violet-400/15 text-violet-200 ring-1 ring-inset ring-violet-400/30",
  listing_ready: "bg-emerald-400/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/30",
  listed: "bg-emerald-400/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/30",
  reserved: "bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-400/30",
  sold: "bg-blue-400/15 text-blue-200 ring-1 ring-inset ring-blue-400/30",
  shipped: "bg-blue-400/15 text-blue-200 ring-1 ring-inset ring-blue-400/30",
  completed: "bg-zinc-400/15 text-zinc-300 ring-1 ring-inset ring-zinc-400/30",
  on_hold: "bg-red-400/15 text-red-200 ring-1 ring-inset ring-red-400/30",
  rejected: "bg-red-400/15 text-red-200 ring-1 ring-inset ring-red-400/30",
  returned: "bg-red-400/15 text-red-200 ring-1 ring-inset ring-red-400/30",
};

/** Solid colour of each status, for dots (lighter at the start of a family, darker at its end) */
export const STATUS_DOT: Record<ItemStatus, string> = {
  received: "bg-violet-300",
  sorted: "bg-violet-400",
  photographed: "bg-violet-500",
  measured: "bg-violet-600",
  listing_ready: "bg-emerald-300",
  listed: "bg-emerald-500",
  reserved: "bg-amber-400",
  sold: "bg-blue-500",
  shipped: "bg-blue-300",
  completed: "bg-zinc-400",
  on_hold: "bg-red-300",
  rejected: "bg-red-600",
  returned: "bg-red-400",
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

/** Contribution rates kept in tax_rates, as the URSSAF names them */
export const TAX_LABEL: Record<string, string> = {
  urssaf_bic_vente: "Cotisations sociales (vente de marchandises)",
  cfp: "Formation professionnelle (CFP)",
  versement_liberatoire: "Versement libératoire de l'impôt",
};
export const taxLabel = (kind: string) => TAX_LABEL[kind] ?? kind;
