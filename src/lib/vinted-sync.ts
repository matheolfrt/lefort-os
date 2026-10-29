// Shapes and words of the Vinted synchronisation page (data from vinted_reconciliation, migration 0020).

export type Issue = "before_start" | "unknown_items" | "possible_match" | "item_conflict" | "missing_price"
  | "cancelled_on_vinted" | "voided_in_lefort" | "price_diff";

export interface VintedItem { external_id: string; title: string; sku: string | null; item_id: string | null; status: string | null; photo: string | null }
export interface OrderCandidate {
  order_id: string; number: number; sold_at: string; gross_cents: number; buyer: string | null; status: string; channel: string; skus: string | null;
}
export interface ItemCandidate { item_id: string; sku: string; title: string | null; brand: string | null; size: string | null; price_cents: number | null; status: string }
export interface UnknownItem { external_id: string; title: string | null; brand: string | null; size: string | null; price_cents: number | null; candidates: ItemCandidate[] }

export interface IssueRow {
  id: string; transaction_id: string; state: string; sold_at: string | null; price_cents: number | null; buyer: string | null;
  title: string | null; issue: Issue; issue_since: string | null; items: VintedItem[];
  order: { id: string; number: number; status: string; gross_cents: number } | null;
  candidates: {
    orders?: OrderCandidate[]; items?: UnknownItem[]; known?: { item_id: string; sku: string; status: string }[]; no_detail?: boolean;
    number?: number; status?: string; lefort_cents?: number; vinted_cents?: number;
    in_stock?: string[]; unknown?: number;
  } | null;
}
export interface RunRow {
  id: string; source: "auto" | "manual"; kind: string; started_at: string; finished_at: string | null;
  status: "running" | "ok" | "partial" | "error"; error: string | null; summary: Record<string, number>;
}
export interface EventRow {
  id: string; at: string; action: string; detail: Record<string, unknown>; transaction_id: string | null; external_id: string | null;
  order_id: string | null; undone_at: string | null; auto: boolean; sku: string | null;
}
export interface Reconciliation {
  since: string; covered_from: string | null; sync_from: string | null; ever: boolean; last_ok_at: string | null;
  last_run: RunRow | null; open_issues: number;
  issues: IssueRow[];
  before_start: { count: number; in_stock: number; rows: (IssueRow & { in_stock: string[] | null; orders: OrderCandidate[] })[] };
  matched: { count: number; rows: { id: string; transaction_id: string; state: string; sold_at: string; price_cents: number; title: string | null;
                                     number: number; order_status: string; match: string }[] };
  ignored: { id: string; transaction_id: string; sold_at: string | null; price_cents: number | null; title: string | null; note: string | null; decided_at: string | null }[];
  lefort_only: { order_id: string; number: number; sold_at: string; gross_cents: number; status: string; buyer: string | null; ref: string | null; skus: string | null }[] | null;
  sold_listings: { external_id: string; title: string | null; url: string | null; photo: string | null; price_cents: number | null; sku: string; item_id: string; last_seen_at: string }[];
  unlinked: { item_id: string; sku: string; title: string | null; brand: string | null; size: string | null; price_cents: number | null; listed_at: string | null;
              suggestions: { external_id: string; title: string | null; url: string | null; photo: string | null; price_cents: number | null }[] }[];
  unlinked_count: number; vinted_unlinked: number;
  events: EventRow[]; runs: RunRow[];
}

export const STATE_LABEL: Record<string, string> = {
  pending: "à expédier", shipped: "expédiée", completed: "terminée", cancelled: "annulée",
};

/** What each issue means, in one sentence */
export const ISSUE_TEXT: Record<Issue, string> = {
  before_start: "Vendue avant la date de début : jamais enregistrée sans votre accord.",
  unknown_items: "Article non reconnu : l'annonce Vinted n'est liée à aucun article de Lefort OS.",
  possible_match: "Ressemble à une vente déjà saisie à la main. Est-ce la même ?",
  item_conflict: "L'article est déjà vendu (ou supprimé) dans Lefort OS, dans une autre vente.",
  missing_price: "Vinted n'a pas donné le prix de cette vente.",
  cancelled_on_vinted: "Annulée sur Vinted, mais toujours en cours dans Lefort OS.",
  voided_in_lefort: "Supprimée dans Lefort OS, mais toujours valable sur Vinted.",
  price_diff: "Le prix saisi dans Lefort OS diffère du prix Vinted.",
};

export const EVENT_LABEL: Record<string, string> = {
  order_imported: "Vente enregistrée", order_linked: "Vente reconnue", order_advanced: "Vente mise à jour",
  order_cancelled: "Vente annulée", listing_linked: "Annonce liée", ignored: "Vente ignorée", unignored: "Vente rétablie",
  price_replaced: "Prix remplacé par celui de Vinted", undone: "Action annulée",
};
/** Actions of the journal that can be undone */
export const UNDOABLE = new Set(["order_imported", "order_linked", "listing_linked", "ignored"]);

export const eur = (c: number | null | undefined) =>
  c == null ? "—" : (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 });

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "jamais";
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
  return `il y a ${Math.round(min / 1440)} j`;
}

/** Hours since the last successful synchronisation, or null if it never ran */
export const staleHours = (lastOk: string | null | undefined, now = Date.now()) =>
  lastOk ? (now - new Date(lastOk).getTime()) / 3_600_000 : null;
