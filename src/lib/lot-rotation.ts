// Rotation of a lot: three different measures, never mixed up.
//   1. Mise en ligne  last item listed − official start (the « 🚀 Premier article mis en ligne » click)
//   2. Vente moyenne  average of (sold − listed) of each sold item, from ITS OWN listing date
//   3. Liquidation    last item sold − official start (not − last listing): the time to turn the lot into cash
// Pure functions on one row of v_lot_rotation (migration 0021), shared by the pages and their tests.

export interface LotRow {
  batch_id: string; code: string; purchased_at: string | null; listing_started_at: string | null; listing_started_edited_at?: string | null;
  total: number; rejected: number; listed: number; sold: number;
  first_listed_at: string | null; last_listed_at: string | null; first_sold_at: string | null; last_sold_at: string | null;
  avg_days_to_sell: number | string | null; timed: number;
}

export type LotStatus = "recu" | "mise_en_ligne" | "en_ligne" | "liquidation" | "liquide";
export const STATUS: Record<LotStatus, { label: string; help: string; tone: string }> = {
  recu: { label: "Stock reçu", help: "Lot acheté, aucun article mis en ligne.", tone: "bg-fg/10 text-fg/80 ring-fg/20" },
  mise_en_ligne: { label: "Mise en ligne", help: "Le premier article est en ligne, pas encore tout le lot.", tone: "bg-sky-400/10 text-sky-300 ring-sky-400/25" },
  en_ligne: { label: "100 % en ligne", help: "Tous les articles sont publiés, aucune vente pour l'instant.", tone: "bg-violet-400/10 text-violet-200 ring-violet-400/25" },
  liquidation: { label: "Liquidation", help: "Tout est en ligne, une partie est vendue : le reste s'écoule.", tone: "bg-amber-400/10 text-amber-300 ring-amber-400/30" },
  liquide: { label: "Liquidé", help: "100 % des articles vendables du lot sont vendus.", tone: "bg-accent/15 text-accent ring-accent/30" },
};

const DAY = 86_400_000;
const t = (iso: string) => new Date(iso).getTime();
/** Days between two instants (fractional) */
export const daysBetween = (from: string, to: string | number) => ((typeof to === "number" ? to : t(to)) - t(from)) / DAY;

export interface Rotation {
  status: LotStatus;
  sellable: number; remaining: number; toList: number; pctListed: number; pctSold: number;
  started: boolean; startMissing: boolean; suggestedStart: string | null;
  /** KPI 1 */
  listing: { days: number | null; done: boolean; elapsed: number | null; rate: number | null; daysLeft: number | null; endAt: string | null };
  /** KPI 2 */
  avgDaysToSell: number | null;
  /** KPI 3 */
  liquidation: { days: number | null; done: boolean; elapsed: number | null };
  /** estimate only, from the lot's own pace of sales */
  projection: { days: number; at: string; rate: number } | null;
  timeline: { key: string; label: string; at: string | null; pending?: boolean }[];
}

/** Enough sales to project: 5 sold and a week since the start */
export const PROJECTION_MIN_SOLD = 5;
export const PROJECTION_MIN_DAYS = 7;

export function rotation(r: LotRow, now = Date.now()): Rotation {
  const sellable = Math.max(0, r.total - r.rejected);
  const listed = Math.min(r.listed, sellable), sold = Math.min(r.sold, sellable);
  const start = r.listing_started_at;
  const allListed = sellable > 0 && listed >= sellable;
  const allSold = sellable > 0 && sold >= sellable;

  const status: LotStatus = allSold ? "liquide"
    : allListed ? (sold > 0 ? "liquidation" : "en_ligne")
    : start || listed > 0 ? "mise_en_ligne" : "recu";

  // KPI 1 — listing time: frozen at the last listing once everything is online, running before
  let listing: Rotation["listing"] = { days: null, done: false, elapsed: null, rate: null, daysLeft: null, endAt: null };
  if (start) {
    const elapsed = Math.max(0, daysBetween(start, now));
    if (allListed && r.last_listed_at) {
      const days = Math.max(0, daysBetween(start, r.last_listed_at));
      listing = { days, done: true, elapsed, rate: listed / Math.max(days, 1), daysLeft: 0, endAt: r.last_listed_at };
    } else {
      const rate = elapsed >= 1 && listed > 0 ? listed / elapsed : null;
      const toList = sellable - listed;
      const daysLeft = rate ? toList / rate : null;
      listing = { days: null, done: false, elapsed, rate, daysLeft,
                  endAt: daysLeft != null ? new Date(now + daysLeft * DAY).toISOString() : null };
    }
  }

  // KPI 2 — each sold item from its own listing date
  const avg = r.avg_days_to_sell == null || r.timed === 0 ? null : Number(r.avg_days_to_sell);

  // KPI 3 — liquidation: from the first listing to the last sale, frozen once everything is sold
  let liquidation: Rotation["liquidation"] = { days: null, done: false, elapsed: null };
  if (start) {
    liquidation = allSold && r.last_sold_at
      ? { days: Math.max(0, daysBetween(start, r.last_sold_at)), done: true, elapsed: null }
      : { days: null, done: false, elapsed: Math.max(0, daysBetween(start, now)) };
  }

  // Projection — an estimate from the lot's own pace of sales, only with enough of them
  let projection: Rotation["projection"] = null;
  if (start && !allSold && sold >= PROJECTION_MIN_SOLD) {
    const elapsed = daysBetween(start, now);
    if (elapsed >= PROJECTION_MIN_DAYS) {
      const rate = sold / elapsed;
      const days = sellable / rate;
      projection = { days, rate, at: new Date(t(start) + days * DAY).toISOString() };
    }
  }

  // the steps of the brief, in their order: purchase → first listing → last listing → last sales → liquidated
  const timeline: Rotation["timeline"] = [
    { key: "achat", label: "Achat", at: r.purchased_at },
    { key: "debut", label: "Premier article mis en ligne", at: start, pending: !start },
    { key: "fin_listing", label: "Dernier article mis en ligne", at: allListed ? r.last_listed_at : null, pending: !allListed },
    { key: "derniere_vente", label: allSold ? "Dernier article vendu" : "Dernière vente à ce jour", at: r.last_sold_at, pending: !r.last_sold_at },
    { key: "liquide", label: "Lot liquidé", at: allSold ? r.last_sold_at : null, pending: !allSold },
  ];

  return {
    status, sellable, remaining: sellable - sold, toList: sellable - listed,
    pctListed: sellable ? (listed * 100) / sellable : 0, pctSold: sellable ? (sold * 100) / sellable : 0,
    started: !!start, startMissing: !start && listed > 0, suggestedStart: !start ? r.first_listed_at : null,
    listing, avgDaysToSell: avg, liquidation, projection, timeline,
  };
}

/** « 29 jours », « 19,7 jours », « 1 jour » */
export function days(v: number | null | undefined, digits = 0) {
  if (v == null) return "—";
  const n = Number(v.toFixed(digits));
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits && n % 1 ? 1 : 0 })} jour${Math.abs(n) >= 2 ? "s" : ""}`;
}
