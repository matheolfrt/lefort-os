import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STOCK_STATUSES } from "@/lib/dashboard";
import type { ItemStatus } from "@/lib/types";

// KPI over time, derived from v_item_economics (one row per item). Historical sales count here:
// they are excluded from the livre des recettes only.

export const PERIODS = [3, 6, 12, 24] as const;
export type Period = (typeof PERIODS)[number];

export interface MonthPoint {
  month: string; // YYYY-MM (Paris)
  revenueCents: number;
  profitCents: number;
  sold: number;
  received: number;
  stockEnd: number; // items in stock at the end of the month
  avgDays: number | null; // listing → sale
  daysN: number;
}

export interface Totals {
  revenueCents: number;
  profitCents: number;
  sold: number;
  avgPriceCents: number | null;
  marginPct: number | null;
  avgDays: number | null;
  daysN: number;
}

export interface Ranked { name: string; sold: number; revenueCents: number; profitCents: number; avgPriceCents: number }

export interface StatsData {
  months: MonthPoint[];
  current: Totals;
  previous: Totals;
  brands: Ranked[];
  categories: Ranked[];
  priceBands: { label: string; sold: number; profitCents: number }[];
  stockNow: { count: number; costCents: number };
}

type Row = {
  status: ItemStatus; brand_id: string | null; category_id: string | null; received_at: string | null; sold_at: string | null;
  is_sold: boolean; revenue_cents: number; gross_profit_cents: number; cost_cents: number; days_to_sell: number | null;
};

const monthKey = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" });
const keyOf = (iso: string) => monthKey.format(new Date(iso)).slice(0, 7);
const PRICE_BANDS = [0, 20, 40, 60, 100, 150, Infinity];

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function totals(sold: Row[]): Totals {
  const revenue = sold.reduce((s, r) => s + Number(r.revenue_cents), 0);
  const profit = sold.reduce((s, r) => s + Number(r.gross_profit_cents), 0);
  const days = sold.filter((r) => r.days_to_sell != null && r.days_to_sell >= 0);
  return {
    revenueCents: revenue,
    profitCents: profit,
    sold: sold.length,
    avgPriceCents: sold.length ? Math.round(revenue / sold.length) : null,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
    avgDays: days.length ? days.reduce((s, r) => s + Number(r.days_to_sell), 0) / days.length : null,
    daysN: days.length,
  };
}

function rank(rows: Row[], key: "brand_id" | "category_id", names: Map<string, string>): Ranked[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r[key] ?? "";
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([k, list]) => {
      const t = totals(list);
      return { name: names.get(k) ?? (key === "brand_id" ? "Sans marque" : "Sans catégorie"), sold: t.sold, revenueCents: t.revenueCents, profitCents: t.profitCents, avgPriceCents: t.avgPriceCents ?? 0 };
    })
    .sort((a, b) => b.profitCents - a.profitCents);
}

export async function loadStats(supabase: SupabaseClient, period: Period, now = Date.now()): Promise<StatsData> {
  const [rows, { data: brands }, { data: categories }] = await Promise.all([
    fetchAll<Row>((from, to) => supabase.from("v_item_economics")
      .select("status, brand_id, category_id, received_at, sold_at, is_sold, revenue_cents, gross_profit_cents, cost_cents, days_to_sell")
      .range(from, to)),
    supabase.from("brands").select("id, name"),
    supabase.from("categories").select("id, name"),
  ]);
  const brandNames = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));
  const categoryNames = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));

  // month keys, oldest first; the previous period has the same length just before
  const [y, m] = keyOf(new Date(now).toISOString()).split("-").map(Number);
  const keyAt = (offset: number) => {
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const keys = Array.from({ length: period }, (_, i) => keyAt(i - period + 1));
  const prevKeys = new Set(Array.from({ length: period }, (_, i) => keyAt(i - 2 * period + 1)));
  const inPeriod = new Set(keys);

  const sold = rows.filter((r) => r.is_sold && r.sold_at);
  const soldIn = sold.filter((r) => inPeriod.has(keyOf(r.sold_at!)));
  const soldPrev = sold.filter((r) => prevKeys.has(keyOf(r.sold_at!)));
  const counted = rows.filter((r) => r.received_at && r.status !== "rejected");

  const months: MonthPoint[] = keys.map((key, i) => {
    const list = soldIn.filter((r) => keyOf(r.sold_at!) === key);
    const t = totals(list);
    const end = new Date(Date.UTC(y, m - 1 + (i - period + 1) + 1, 1)).toISOString();
    return {
      month: key,
      revenueCents: t.revenueCents,
      profitCents: t.profitCents,
      sold: t.sold,
      received: counted.filter((r) => keyOf(r.received_at!) === key).length,
      stockEnd: counted.filter((r) => r.received_at! < end && !(r.is_sold && r.sold_at && r.sold_at < end)).length,
      avgDays: t.avgDays,
      daysN: t.daysN,
    };
  });

  const priceBands = PRICE_BANDS.slice(0, -1).map((lo, i) => {
    const hi = PRICE_BANDS[i + 1];
    const list = soldIn.filter((r) => r.revenue_cents >= lo * 100 && r.revenue_cents < hi * 100);
    return {
      label: hi === Infinity ? `${lo} € et +` : `${lo}–${hi} €`,
      sold: list.length,
      profitCents: list.reduce((s, r) => s + Number(r.gross_profit_cents), 0),
    };
  });

  const stock = rows.filter((r) => STOCK_STATUSES.includes(r.status));
  return {
    months,
    current: totals(soldIn),
    previous: totals(soldPrev),
    brands: rank(soldIn, "brand_id", brandNames),
    categories: rank(soldIn, "category_id", categoryNames),
    priceBands,
    stockNow: { count: stock.length, costCents: stock.reduce((s, r) => s + Number(r.cost_cents), 0) },
  };
}
