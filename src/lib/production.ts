import type { ItemStatus } from "@/lib/types";

// Production board (Postes → Production): the nine columns and what has to be done in each.
// Mirrors the database (private.board_columns / board_next / task_columns in migration 0012).

export type BoardStatus = "received" | "sorted" | "photographed" | "measured" | "listing_ready" | "listed" | "reserved" | "sold" | "shipped";

export interface ColumnDef {
  status: BoardStatus;
  label: string;
  emoji: string;
  /** what the person does to move an item out of this column (null: waiting on the buyer) */
  task: string | null;
  /** short noun for counters ("42 photos") */
  taskNoun: string | null;
  taskEmoji: string | null;
}

export const COLUMNS: ColumnDef[] = [
  { status: "received", label: "Réception", emoji: "📦", task: "Trier", taskNoun: "Tri", taskEmoji: "🗂️" },
  { status: "sorted", label: "Tri", emoji: "🗂️", task: "Photographier", taskNoun: "Photos", taskEmoji: "📸" },
  { status: "photographed", label: "Photographie", emoji: "📸", task: "Mesurer", taskNoun: "Mesures", taskEmoji: "📏" },
  { status: "measured", label: "Mesure", emoji: "📏", task: "Ranger", taskNoun: "Rangement", taskEmoji: "🗄️" },
  { status: "listing_ready", label: "Prêt à publier", emoji: "📝", task: "Publier", taskNoun: "Publications", taskEmoji: "📝" },
  { status: "listed", label: "En ligne", emoji: "🟢", task: null, taskNoun: null, taskEmoji: null },
  { status: "reserved", label: "Réservé", emoji: "🤝", task: null, taskNoun: null, taskEmoji: null },
  { status: "sold", label: "Vendu", emoji: "💶", task: "Expédier", taskNoun: "Expéditions", taskEmoji: "🚚" },
  { status: "shipped", label: "Expédié", emoji: "🚚", task: null, taskNoun: null, taskEmoji: null },
];

export const COLUMN = Object.fromEntries(COLUMNS.map((c) => [c.status, c])) as Record<BoardStatus, ColumnDef>;
export const TASK_COLUMNS: BoardStatus[] = ["received", "sorted", "photographed", "measured", "listing_ready", "sold"];

export const nextColumn = (s: BoardStatus): BoardStatus | null => {
  const i = COLUMNS.findIndex((c) => c.status === s);
  return i >= 0 && i < COLUMNS.length - 1 ? COLUMNS[i + 1].status : null;
};
export const columnIndex = (s: BoardStatus) => COLUMNS.findIndex((c) => c.status === s);

export type Priority = 0 | 1 | 2 | 3;
export const PRIORITIES: { value: Priority; label: string; short: string; dot: string; text: string }[] = [
  { value: 3, label: "Urgente", short: "URGENT", dot: "bg-red-500", text: "text-red-300" },
  { value: 2, label: "Haute", short: "HAUTE", dot: "bg-orange-400", text: "text-orange-300" },
  { value: 1, label: "Normale", short: "NORMALE", dot: "bg-yellow-300", text: "text-yellow-200" },
  { value: 0, label: "Basse", short: "BASSE", dot: "bg-zinc-300", text: "text-zinc-300" },
];
export const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.value, p])) as Record<Priority, (typeof PRIORITIES)[number]>;

export type BlockReason = "missing_photos" | "missing_measurements" | "defect_check" | "wrong_sku" | "missing_info" | "quality" | "other";
export const BLOCK_LABEL: Record<BlockReason, string> = {
  missing_photos: "Photo manquante",
  missing_measurements: "Mesures manquantes",
  defect_check: "Défaut à vérifier",
  wrong_sku: "SKU incorrect",
  missing_info: "Informations manquantes",
  quality: "Problème qualité",
  other: "Autre",
};

export type SortKey = "priority" | "oldest" | "newest" | "brand" | "price" | "margin" | "sku";
export const SORTS: { value: SortKey; label: string; manager?: boolean }[] = [
  { value: "priority", label: "Priorité" },
  { value: "oldest", label: "Plus ancien" },
  { value: "newest", label: "Plus récent" },
  { value: "brand", label: "Marque" },
  { value: "price", label: "Prix de vente" },
  { value: "margin", label: "Marge", manager: true },
  { value: "sku", label: "SKU" },
];

/** One card, as returned by production_board / production_card / next_task */
export interface BoardCard {
  id: string;
  sku: string;
  title: string | null;
  version: number;
  status: ItemStatus;
  col: BoardStatus;
  hold_reason: string | null;
  status_before_hold: ItemStatus | null;
  brand: string | null;
  category: string | null;
  size: string | null;
  batch_id: string;
  batch: string | null;
  supplier: string | null;
  location: string | null;
  location_label: string | null;
  price_cents: number | null;
  cost_cents: number | null;
  priority: Priority;
  blocked_reason: BlockReason | null;
  blocked_note: string | null;
  blocked_at: string | null;
  assigned_to: string | null;
  assignee: string | null;
  claimed_by: string | null;
  claimer: string | null;
  status_changed_at: string;
  received_at: string;
  photo_count: number;
  photo_path: string | null;
  listing_url: string | null;
  order_id: string | null;
  rn?: number;
}

export interface ColumnTotals {
  status: BoardStatus;
  count: number;
  in_progress: number;
  blocked: number;
  value_cents: number;
  cost_cents: number | null;
}

export interface BoardData {
  columns: ColumnTotals[];
  items: BoardCard[];
  is_manager: boolean;
}

export interface Filters {
  q?: string;
  brand_id?: string;
  category_id?: string;
  supplier_id?: string;
  batch_id?: string;
  size?: string;
  assigned?: string; // "me" | "none" | user id
  age_min?: number;
  age_max?: number;
  cost_min?: number;
  cost_max?: number;
  price_min?: number;
  price_max?: number;
  blocked?: boolean;
  columns?: BoardStatus[];
}

/** Where the work of a task is done (null: the board itself is enough) */
export function stationHref(card: Pick<BoardCard, "col" | "sku" | "batch_id" | "order_id">): string | null {
  switch (card.col) {
    case "received": return `/postes/reception?batch=${card.batch_id}`;
    case "sorted": return `/postes/photo?sku=${encodeURIComponent(card.sku)}`;
    case "photographed": return `/postes/photo?sku=${encodeURIComponent(card.sku)}`;
    case "measured": return `/postes/rangement`;
    case "listing_ready": return `/postes/publication?sku=${encodeURIComponent(card.sku)}`;
    case "sold": return card.order_id ? `/postes/expedition?commande=${card.order_id}` : `/postes/expedition`;
    default: return null;
  }
}

/** "3 j", "5 h", "12 min" since a date */
export function since(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

/** 315 s → "5 min 15", 9400 s → "2 h 37", 2 days → "2 j 14 h" */
export function duration(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "—";
  const s = Math.round(secs);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${String(s % 60).padStart(2, "0")}` : ""}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
  return `${Math.floor(h / 24)} j${h % 24 ? ` ${h % 24} h` : ""}`;
}

export const perHour = (n: number, secs: number) => (secs > 0 ? (n * 3600) / secs : null);

export type MoveKind = "same" | "usual" | "manual" | "sale" | "blocked" | "forbidden";

/** What dropping a card on a column means — the database applies the same rules (kanban_move) */
export function moveKind(card: Pick<BoardCard, "col" | "status" | "blocked_reason">, to: BoardStatus, isManager: boolean): MoveKind {
  const onHold = card.status === "on_hold";
  if (to === card.col && !onHold) return "same";
  if (["sold", "shipped", "completed"].includes(card.status)) return card.col === "sold" && to === "shipped" ? "sale" : "forbidden";
  if (to === "sold") return ["listed", "reserved", "listing_ready"].includes(card.status) ? "sale" : "forbidden";
  if (to === "shipped") return "forbidden";
  const usual = nextColumn(card.col) === to || (onHold && to === card.col);
  if (card.blocked_reason) return isManager ? "manual" : "blocked";
  if (usual) return "usual";
  return isManager ? "manual" : "forbidden";
}
