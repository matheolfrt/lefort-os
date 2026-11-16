import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { parisToday } from "@/lib/format";
import { STOCK_STATUSES } from "@/lib/dashboard";
import { UNKNOWN_COST_MAX } from "@/lib/kpi/classify";
import { capital, cashPosition, forecast, immobilization, ownerDraw, performance, purchaseBudget, turnover } from "./calc";
import { estimateCosts, monthlyPnl, type ExpenseRow, type SoldCostRow, type StockCostRow } from "./estimate";
import type { Overview } from "./types";

const DAY = 86_400_000;

// A read that fails throws: half of the rows would give figures that look right and are not
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

type Eco = {
  item_id: string; cost_cents: number | string; revenue_cents: number | string; variable_costs_cents: number | string; vat_cents: number | string;
  sold_at: string | null; received_at: string | null; listed_at: string | null; brand_id: string | null; category_id: string | null;
};

/**
 * The rows behind the estimates: the pieces in stock whose purchase price was never entered, the sales of the last
 * 13 months (or twice the analysis period), and the expenses of those months. Read item by item because the type of a
 * piece (Harris, coat…) is read from its title.
 */
async function loadRows(supabase: SupabaseClient, o: Overview) {
  const now = new Date(o.now).getTime();
  const since = new Date(now - Math.max(400, 2 * o.periods.days + 1) * DAY).toISOString();
  const dailyFrom = new Date(now - (o.daily.length + 2) * DAY).toISOString();
  const cols = "item_id, cost_cents, revenue_cents, variable_costs_cents, vat_cents, sold_at, received_at, listed_at, brand_id, category_id";
  const [stockEco, soldEco, stockItems, soldItems, brands, categories, live, expenses] = await Promise.all([
    fetchAll<Eco>((a, b) => supabase.from("v_item_economics").select(cols).in("status", STOCK_STATUSES).lte("cost_cents", UNKNOWN_COST_MAX).order("item_id").range(a, b)),
    fetchAll<Eco>((a, b) => supabase.from("v_item_economics").select(cols).eq("is_sold", true).gte("sold_at", since).order("item_id").range(a, b)),
    fetchAll<{ id: string; title: string | null; list_price_cents: number | null }>((a, b) => supabase.from("items")
      .select("id, title, list_price_cents").is("deleted_at", null).in("status", STOCK_STATUSES).order("id").range(a, b)),
    fetchAll<{ id: string; title: string | null }>((a, b) => supabase.from("items").select("id, title").is("deleted_at", null).gte("sold_at", since).order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("brands").select("id, name").order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("categories").select("id, name").order("id").range(a, b)),
    // the sales the forecast counts day by day: active lines of orders that are not imported history
    fetchAll<{ item_id: string }>((a, b) => supabase.from("order_lines").select("item_id, orders!inner(sold_at, is_historical, status)")
      .eq("status", "active").lte("cost_snapshot_cents", UNKNOWN_COST_MAX).eq("orders.is_historical", false).neq("orders.status", "cancelled")
      .gte("orders.sold_at", dailyFrom).order("id").range(a, b)),
    fetchAll<{ spent_on: string; category: string; amount_cents: number | string }>((a, b) => supabase.from("expenses")
      .select("spent_on, category, amount_cents").gte("spent_on", since.slice(0, 10)).order("id").range(a, b)),
  ]);
  const brand = new Map(brands.map((x) => [x.id, x.name])), category = new Map(categories.map((x) => [x.id, x.name]));
  const stockBy = new Map(stockItems.map((i) => [i.id, i])), soldTitle = new Map(soldItems.map((i) => [i.id, i.title]));
  const inDaily = new Set(live.map((l) => l.item_id));
  const names = (e: Eco) => ({ brand: e.brand_id ? brand.get(e.brand_id) ?? null : null, category: e.category_id ? category.get(e.category_id) ?? null : null });

  const stock: StockCostRow[] = stockEco.map((e) => {
    const i = stockBy.get(e.item_id);
    const basis = o.settings.aging_basis === "listed" ? e.listed_at ?? e.received_at : e.received_at;
    return {
      title: i?.title ?? null, ...names(e), cost: Number(e.cost_cents), priced: i?.list_price_cents != null,
      age: basis ? Math.floor((now - new Date(basis).getTime()) / DAY) : 0,
    };
  });
  const sold: SoldCostRow[] = soldEco.filter((e) => e.sold_at).map((e) => ({
    title: soldTitle.get(e.item_id) ?? null, ...names(e), cost: Number(e.cost_cents), soldAt: e.sold_at!, revenue: Number(e.revenue_cents),
    variable: Number(e.variable_costs_cents) + Number(e.vat_cents), inDaily: inDaily.has(e.item_id),
  }));
  const spent: ExpenseRow[] = expenses.map((e) => ({ spentOn: e.spent_on, category: e.category, cents: Number(e.amount_cents) }));
  return { stock, sold, spent };
}

/**
 * Everything the command center and the dashboard card show, computed once from finance_overview.
 * Returns null when the database is not up to date (the function is missing) or the user is not a manager.
 * `snapshot` records today's capital (once a day is enough: the row is upserted), which feeds the evolution and averages.
 * The pieces without a real purchase price are counted at an assumed price (see estimate.ts): `o.estimate` says how many.
 */
export async function loadFinance({ snapshot = false } = {}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_overview");
  if (error || !data) return null;
  const raw = data as Overview;
  // when the rows cannot be read, the page shows the figures as entered and says so (never a silent mix of both)
  const rows = await loadRows(supabase, raw).catch((e: Error) => { console.error("finance: estimates unavailable —", e.message); return null; });
  const o = rows ? estimateCosts(raw, rows.stock, rows.sold) : raw;
  const today = parisToday(new Date(o.now));
  const cash = cashPosition(o, today);
  const cap = capital(o, cash);
  const perf = performance(o, today);
  const turn = turnover(o, perf, cap, today);
  const fc = forecast(o, cash, today);
  const budget = purchaseBudget(o, cash, fc, today);
  const immob = immobilization(o.stock.cost_cents, cap.total, o.settings.immob_levels);
  const draw = ownerDraw(budget);
  const months = rows ? monthlyPnl(o, rows.sold, rows.spent, today) : null;
  if (snapshot) {
    // recorded as entered (without the assumed prices): they are added again each time the page is computed
    await supabase.rpc("finance_snapshot", {
      p_cash: cash.known ? cash.cents : null, p_stock: raw.stock.cost_cents, p_dormant: raw.stock.dormant_cost_cents, p_receivable: o.receivable.amount_cents,
    });
  }
  return { o, today, cash, cap, perf, turn, fc, budget, immob, draw, months, estimated: rows != null };
}

export type FinanceData = NonNullable<Awaited<ReturnType<typeof loadFinance>>>;
