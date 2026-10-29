// When a lot pays itself back: the money that came in for its items (net of fees, refunds deducted) against what it
// cost. Pure functions on one row of v_lot_payback (migration 0022), shared by the pages and their tests.

export interface PaybackRow {
  batch_id: string; code: string; purchased_at: string | null; listing_started_at: string | null;
  cost_cents: number | string; recovered_cents: number | string; pending_cents: number | string; cashed_sales: number;
  first_cash_at: string | null; last_cash_at: string | null; payback_at: string | null;
}

export type PaybackStatus = "sans_cout" | "pas_commence" | "en_cours" | "rembourse" | "perte";

export interface Payback {
  status: PaybackStatus;
  cost: number; recovered: number; pending: number; remaining: number;
  pct: number;                 // of the cost recovered, 0–100 (can be over 100 once paid back)
  at: string | null;           // the day it was paid back
  daysFromPurchase: number | null; daysFromStart: number | null;
  /** estimate only, from the lot's own pace of money in, with enough of it */
  projection: { at: string; days: number; perDay: number } | null;
}

const DAY = 86_400_000;
/** Enough money in to estimate: 5 sales paid and two weeks of sales */
export const PAYBACK_MIN_SALES = 5;
export const PAYBACK_MIN_DAYS = 14;

const t = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime();
const between = (from: string, to: string | number) => ((typeof to === "number" ? to : t(to)) - t(from)) / DAY;

/** `left`: items of the lot still to sell (from its rotation); none left and the cost not reached is a loss */
export function payback(r: PaybackRow, now = Date.now(), left: number | null = null): Payback {
  const cost = Number(r.cost_cents), recovered = Number(r.recovered_cents), pending = Number(r.pending_cents);
  const base = { cost, recovered, pending, remaining: Math.max(0, cost - recovered), at: null, daysFromPurchase: null, daysFromStart: null, projection: null };
  if (cost <= 0) return { ...base, status: "sans_cout", pct: 0 };
  const pct = (recovered * 100) / cost;
  if (r.payback_at) {
    return { ...base, status: "rembourse", pct, at: r.payback_at,
      daysFromPurchase: r.purchased_at ? Math.max(0, Math.round(between(r.purchased_at, r.payback_at))) : null,
      daysFromStart: r.listing_started_at ? Math.max(0, Math.round(between(r.listing_started_at, r.payback_at))) : null };
  }
  // everything sold and paid, and still under the cost: it will not be paid back
  if (left === 0 && pending === 0 && r.first_cash_at) return { ...base, status: "perte", pct };
  if (!r.first_cash_at) return { ...base, status: "pas_commence", pct: 0 };

  // pace: the money in since sales started (the official start of the listing, or the first money in)
  let projection: Payback["projection"] = null;
  const from = r.listing_started_at && r.listing_started_at < r.first_cash_at ? r.listing_started_at : r.first_cash_at;
  const elapsed = between(from, now);
  if (r.cashed_sales >= PAYBACK_MIN_SALES && elapsed >= PAYBACK_MIN_DAYS && recovered > 0) {
    const perDay = recovered / elapsed;
    const days = (cost - recovered) / perDay;
    projection = { perDay, days, at: new Date(now + days * DAY).toISOString() };
  }
  return { ...base, status: "en_cours", pct, projection };
}

export const PAYBACK_LABEL: Record<PaybackStatus, string> = {
  sans_cout: "Coût non saisi", pas_commence: "Rien encaissé", en_cours: "En cours", rembourse: "Remboursé", perte: "Non remboursé",
};
