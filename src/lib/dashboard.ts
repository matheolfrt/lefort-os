import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemStatus, Organization } from "@/lib/types";

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
}

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
  const [econ, { data: turnover }, { data: monthOrders }, { data: rates }] = await Promise.all([
    fetchAll<{ status: ItemStatus; sold_at: string | null; cost_cents: number; revenue_cents: number; variable_costs_cents: number;
      vat_cents: number; gross_profit_cents: number; is_sold: boolean; days_to_sell: number | null }>(
      (from, to) => supabase.from("v_item_economics")
        .select("status, sold_at, cost_cents, revenue_cents, variable_costs_cents, vat_cents, gross_profit_cents, is_sold, days_to_sell")
        .range(from, to),
    ),
    supabase.from("v_monthly_turnover").select("month, turnover_cents").gte("month", since12).order("month"),
    supabase.from("orders").select("gross_cents").neq("status", "cancelled").gte("sold_at", p.monthStart),
    supabase.from("tax_rates").select("kind, rate_pct, valid_from").lte("valid_from", new Date(now).toISOString().slice(0, 10))
      .order("valid_from", { ascending: false }),
  ]);

  // current contribution rate: latest rate of each kind
  const latest = new Map<string, number>();
  for (const r of rates ?? []) if (!latest.has(r.kind)) latest.set(r.kind, Number(r.rate_pct));
  const ratePct = (latest.get("urssaf_bic_vente") ?? 0) + (latest.get("cfp") ?? 0)
    + (org.versement_liberatoire ? latest.get("versement_liberatoire") ?? 0 : 0);

  const period = (start: string): PeriodResult => {
    const sold = econ.filter((e) => e.is_sold && e.sold_at && e.sold_at >= start);
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

  const ninetyDaysAgo = new Date(now - 90 * DAY).toISOString();
  const recentDelays = econ.filter((e) => e.is_sold && e.sold_at && e.sold_at >= ninetyDaysAgo && e.days_to_sell != null && e.days_to_sell >= 0);
  const baskets = (monthOrders ?? []).map((o) => Number(o.gross_cents));

  data.finance = {
    monthCashedCents: months.at(-1)?.cents ?? 0,
    yearCashedCents: months.filter((m) => m.month >= p.yearStart.slice(0, 7)).reduce((s, m) => s + m.cents, 0),
    months,
    month: period(p.monthStart),
    year: period(p.yearStart),
    stockCostCents: econ.filter((e) => STOCK_STATUSES.includes(e.status)).reduce((s, e) => s + Number(e.cost_cents), 0),
    avgBasket: { cents: baskets.length ? Math.round(baskets.reduce((a, b) => a + b, 0) / baskets.length) : null, n: baskets.length },
    avgDaysToSell: {
      days: recentDelays.length ? recentDelays.reduce((s, e) => s + Number(e.days_to_sell), 0) / recentDelays.length : null,
      n: recentDelays.length,
    },
    contributionRatePct: ratePct,
  };
  return data;
}
