import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemStatus, Organization } from "@/lib/types";
import { buildTrend, parisDay, type TrendPeriod } from "@/lib/trend";
import { compareAll, type Comparison, type MetricId } from "@/lib/compare";

// Everything on the dashboard is derived from existing tables/views; nothing is stored.

/** Statuses of items physically in stock (bought, not sold, not discarded) */
export const STOCK_STATUSES: ItemStatus[] = [
  "received", "sorted", "photographed", "measured", "listing_ready", "listed", "reserved", "on_hold", "returned",
];
const IMPORT_LOCATION = "EMP-A-ETIQUETER";
/** Below this many observations a statistic is shown with its sample size */
export const LOW_SAMPLE = 10;

export interface QueueCount { count: number; oldestDays: number | null }

export interface DashboardData {
  pipeline: Partial<Record<ItemStatus, QueueCount>>;
  toLabel: number;
  shipping: { orders: number; oldestDays: number | null };
  stock: { count: number; listedCount: number; pricedCount: number; potentialCents: number };
  ageBuckets: { label: string; count: number; tone: "ok" | "watch" | "warn" | "alert" }[];
  finance: FinanceData | null; // managers only
}

export interface PeriodResult {
  revenueCents: number;
  costsCents: number;
  contributionsCents: number;
  beforeCents: number;
  afterCents: number;
  itemsSold: number;
}

export interface FinanceData {
  monthCashedCents: number;
  yearCashedCents: number;
  months: { month: string; cents: number }[]; // last 12 months, oldest first
  month: PeriodResult;
  year: PeriodResult;
  stockCostCents: number;
  avgBasket: { cents: number | null; n: number };
  avgDaysToSell: { days: number | null; n: number };
  contributionRatePct: number;
  trend: { month: TrendPeriod; week: TrendPeriod };
  /** each figure of the month against the same days of last month and the months before */
  compare: Record<MetricId, Comparison>;
  /** mean time to sell over the same 90 days, shown next to the median */
  avgDaysToSellMean: number | null;
  /** what buyers paid against the price shown (last 90 days); absent before the database update */
  realised: Realised | null;
  /** returns over the last 12 months; absent before the database update */
  returns: ReturnStats | null;
}

export interface Realised { days: number; n: number; paid_cents: number; shown_cents: number; ratio: number | null }
export interface ReturnStats {
  from: string; to: string; sold: number; returned: number; refunded_cents: number;
  lost_fees_cents: number; resold: number; resale_loss_cents: number; goodwill_cents: number; goodwill_n: number;
  by_brand: { label: string; sold: number; returned: number }[];
  by_size: { label: string; sold: number; returned: number }[];
  by_reason: { label: string; n: number }[];
}
/** What returns cost: fees paid for nothing, cheaper resales, goodwill refunds */
export const returnsLoss = (r: ReturnStats) => Number(r.lost_fees_cents) + Number(r.resale_loss_cents) + Number(r.goodwill_cents);

const DAY = 86_400_000;
const ageDays = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));

/** PostgREST returns at most 1000 rows per request: page through larger result sets */
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

/** Start of the current month / year in Europe/Paris, as ISO strings */
function parisPeriodStarts(now: Date) {
  const [y, m] = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" })
    .format(now).split("-");
  return { year: Number(y), monthIdx: Number(m) - 1, monthStart: `${y}-${m}-01`, yearStart: `${y}-01-01` };
}

export async function loadDashboard(supabase: SupabaseClient, org: Organization, isManager: boolean): Promise<DashboardData> {
  const now = Date.now();
  const p = parisPeriodStarts(new Date(now));

  const [stockItems, { data: shipRows }, { data: importLoc }] = await Promise.all([
    fetchAll<{ status: ItemStatus; received_at: string; status_changed_at: string; list_price_cents: number | null; current_location_id: string | null }>(
      (from, to) => supabase.from("items")
        .select("status, received_at, status_changed_at, list_price_cents, current_location_id")
        .is("deleted_at", null).in("status", [...STOCK_STATUSES, "sold", "shipped"]).range(from, to),
    ),
    supabase.rpc("shipping_queue"),
    supabase.from("locations").select("id").eq("code", IMPORT_LOCATION).maybeSingle(),
  ]);

  // ── Pipeline & queues
  const pipeline: DashboardData["pipeline"] = {};
  for (const it of stockItems) {
    const q = (pipeline[it.status] ??= { count: 0, oldestDays: null });
    q.count++;
    const d = ageDays(it.status_changed_at, now);
    q.oldestDays = Math.max(q.oldestDays ?? 0, d);
  }
  const toLabel = importLoc ? stockItems.filter((i) => i.current_location_id === importLoc.id && STOCK_STATUSES.includes(i.status)).length : 0;

  const orders = new Map<string, string>();
  for (const r of (shipRows ?? []) as { order_id: string; sold_at: string }[]) orders.set(r.order_id, r.sold_at);
  const oldestSale = [...orders.values()].sort()[0];

  // ── Stock
  const inStock = stockItems.filter((i) => STOCK_STATUSES.includes(i.status));
  const priced = inStock.filter((i) => i.list_price_cents);
  const buckets = [
    { label: "0–30 j", min: 0, max: 30, tone: "ok" as const },
    { label: "31–60 j", min: 31, max: 60, tone: "watch" as const },
    { label: "61–90 j", min: 61, max: 90, tone: "warn" as const },
    { label: "90 j et +", min: 91, max: Infinity, tone: "alert" as const },
  ].map((b) => ({
    label: b.label,
    tone: b.tone,
    count: inStock.filter((i) => { const d = ageDays(i.received_at, now); return d >= b.min && d <= b.max; }).length,
  }));

  const data: DashboardData = {
    pipeline,
    toLabel,
    shipping: { orders: orders.size, oldestDays: oldestSale ? ageDays(oldestSale, now) : null },
    stock: {
      count: inStock.length,
      listedCount: inStock.filter((i) => i.status === "listed" || i.status === "reserved").length,
      pricedCount: priced.length,
      potentialCents: priced.reduce((s, i) => s + (i.list_price_cents ?? 0), 0),
    },
    ageBuckets: buckets,
    finance: null,
  };
  if (!isManager) return data;

  // ── Money (RLS returns nothing for operators anyway)
  const since12 = new Date(Date.UTC(p.year, p.monthIdx - 11, 1)).toISOString().slice(0, 10);
  // comparisons go back three months (same days); a day of margin for the Paris calendar
  const since3 = new Date(Date.UTC(p.year, p.monthIdx - 3, 1) - DAY).toISOString().slice(0, 10);
  const [econ, { data: turnover }, recentOrders, cashRows, { data: rates }, { data: goals }, realised, returns] = await Promise.all([
    fetchAll<{ status: ItemStatus; listed_at: string | null; sold_at: string | null; cost_cents: number; revenue_cents: number; variable_costs_cents: number;
      vat_cents: number; gross_profit_cents: number; is_sold: boolean; days_to_sell: number | null }>(
      (from, to) => supabase.from("v_item_economics")
        .select("status, listed_at, sold_at, cost_cents, revenue_cents, variable_costs_cents, vat_cents, gross_profit_cents, is_sold, days_to_sell")
        .range(from, to),
    ),
    supabase.from("v_monthly_turnover").select("month, turnover_cents").gte("month", since12).order("month"),
    fetchAll<{ sold_at: string; gross_cents: number }>((from, to) => supabase.from("orders").select("sold_at, gross_cents")
      .neq("status", "cancelled").gte("sold_at", since3).order("sold_at").range(from, to)),
    fetchAll<{ date_encaissement: string; montant_cents: number }>((from, to) => supabase.from("v_livre_recettes")
      .select("date_encaissement, montant_cents").gte("date_encaissement", since3).order("date_encaissement").range(from, to)),
    supabase.from("tax_rates").select("kind, rate_pct, valid_from").lte("valid_from", new Date(now).toISOString().slice(0, 10))
      .order("valid_from", { ascending: false }),
    // objectives (Objectifs) draw the pace line; absent until the database update that adds them
    supabase.from("goals").select("period, metric, target").then((r) => (r.error ? { data: [] } : r)),
    // migration 0022: absent before that database update, then the figures simply are not shown
    supabase.rpc("realised_price", { p_days: 90 }).then((r) => (r.error ? null : (r.data as Realised))),
    supabase.rpc("return_stats").then((r) => (r.error ? null : (r.data as ReturnStats))),
  ]);

  // current contribution rate: latest rate of each kind
  const latest = new Map<string, number>();
  for (const r of rates ?? []) if (!latest.has(r.kind)) latest.set(r.kind, Number(r.rate_pct));
  const ratePct = (latest.get("urssaf_bic_vente") ?? 0) + (latest.get("cfp") ?? 0)
    + (org.versement_liberatoire ? latest.get("versement_liberatoire") ?? 0 : 0);

  // sales by their day in Paris (a sale at 23:30 on the 31st belongs to that month, whatever the UTC date says)
  const soldRows = econ.filter((e) => e.is_sold && e.sold_at).map((e) => ({ e, day: parisDay(e.sold_at!) }));
  const period = (start: string): PeriodResult => {
    const sold = soldRows.filter((r) => r.day >= start).map((r) => r.e);
    const revenue = sold.reduce((s, e) => s + Number(e.revenue_cents), 0);
    const costs = sold.reduce((s, e) => s + Number(e.cost_cents) + Number(e.variable_costs_cents) + Number(e.vat_cents), 0);
    const contributions = Math.round((revenue * ratePct) / 100);
    return { revenueCents: revenue, costsCents: costs, contributionsCents: contributions,
      beforeCents: revenue - costs, afterCents: revenue - costs - contributions, itemsSold: sold.length };
  };

  const byMonth = new Map((turnover ?? []).map((t) => [String(t.month).slice(0, 7), Number(t.turnover_cents)]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = new Date(Date.UTC(p.year, p.monthIdx - 11 + i, 1)).toISOString().slice(0, 7);
    return { month: key, cents: byMonth.get(key) ?? 0 };
  });

  const compare = compareAll({
    today: parisDay(new Date(now)),
    sold: soldRows.map(({ e, day }) => ({ day, revenue: Number(e.revenue_cents),
      costs: Number(e.cost_cents) + Number(e.variable_costs_cents) + Number(e.vat_cents),
      delay: e.days_to_sell == null ? null : Number(e.days_to_sell) })),
    orders: recentOrders.map((o) => ({ day: parisDay(o.sold_at), gross: Number(o.gross_cents) })),
    cash: cashRows.map((c) => ({ day: String(c.date_encaissement).slice(0, 10), cents: Number(c.montant_cents) })),
    ratePct,
    // every item that went on sale, sold or not (written-off ones never had their chance to sell)
    listed: econ.filter((e) => e.listed_at && e.status !== "rejected").map((e) => ({
      listed: parisDay(e.listed_at!), sold: e.is_sold && e.sold_at ? parisDay(e.sold_at) : null })),
    since: soldRows.reduce<string | null>((m, r) => (m == null || r.day < m ? r.day : m), null),
  });
  const ninety = parisDay(new Date(now - 89 * DAY));
  const delays = soldRows.filter((r) => r.day >= ninety && r.e.days_to_sell != null && Number(r.e.days_to_sell) >= 0).map((r) => Number(r.e.days_to_sell));

  data.finance = {
    monthCashedCents: months.at(-1)?.cents ?? 0,
    yearCashedCents: months.filter((m) => m.month >= p.yearStart.slice(0, 7)).reduce((s, m) => s + m.cents, 0),
    months,
    month: period(p.monthStart),
    year: period(p.yearStart),
    stockCostCents: econ.filter((e) => STOCK_STATUSES.includes(e.status)).reduce((s, e) => s + Number(e.cost_cents), 0),
    // the same figures as their comparisons (Paris days): orders of the month, sales of the last 90 days
    avgBasket: { cents: compare.basket.cur == null ? null : Math.round(compare.basket.cur), n: compare.basket.n },
    avgDaysToSell: { days: compare.delay.cur, n: compare.delay.n },
    contributionRatePct: ratePct,
    trend: buildTrend(econ.filter((e) => e.is_sold), new Date(now),
      ((goals ?? []) as { period: string; metric: string; target: number }[])),
    compare,
    avgDaysToSellMean: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
    realised,
    returns,
  };
  return data;
}
