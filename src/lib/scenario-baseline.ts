import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STOCK_STATUSES } from "@/lib/dashboard";
import { DEFAULTS, type ScenarioInputs } from "@/lib/scenario";
import type { ItemStatus, Organization } from "@/lib/types";

// "Mes chiffres réels": the scenario inputs measured on the business itself (last 90 days of sales).

export interface Baseline { inputs: ScenarioInputs; basis: string[] }

const DAY = 86_400_000;
const round = (v: number, step = 1) => Number((Math.round(v / step) * step).toFixed(2));

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

export async function loadBaseline(supabase: SupabaseClient, org: Organization, now = Date.now()): Promise<Baseline> {
  const since = new Date(now - 90 * DAY).toISOString();
  const [econ, orders, { data: rates }, { data: expenses }, { data: recurring }] = await Promise.all([
    fetchAll<{ status: ItemStatus; cost_cents: number; revenue_cents: number; is_sold: boolean; sold_at: string | null }>((from, to) =>
      supabase.from("v_item_economics").select("status, cost_cents, revenue_cents, is_sold, sold_at").range(from, to)),
    fetchAll<{ shipping_cost_cents: number; packaging_cost_cents: number; order_lines: { id: string }[] }>((from, to) =>
      supabase.from("orders").select("shipping_cost_cents, packaging_cost_cents, order_lines(id)")
        .neq("status", "cancelled").gte("sold_at", since).range(from, to)),
    supabase.from("tax_rates").select("kind, rate_pct, valid_from").lte("valid_from", new Date(now).toISOString().slice(0, 10))
      .order("valid_from", { ascending: false }),
    supabase.from("expenses").select("amount_cents, category").gte("spent_on", since.slice(0, 10)),
    // recurring charges of the finance settings (absent before that database update: then simply none)
    supabase.from("recurring_expenses").select("category, amount_cents, frequency, ends_on"),
  ]);

  const basis: string[] = [];
  const stock = econ.filter((e) => STOCK_STATUSES.includes(e.status));
  const sold = econ.filter((e) => e.is_sold && e.sold_at);
  const recent = sold.filter((e) => e.sold_at! >= since);
  const priced = recent.length >= 5 ? recent : sold;
  const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  const costs = stock.map((e) => Number(e.cost_cents)).filter((c) => c > 0);
  const cost = avg(costs.length ? costs : sold.map((e) => Number(e.cost_cents)).filter((c) => c > 0));
  const price = avg(priced.map((e) => Number(e.revenue_cents)).filter((c) => c > 0));
  const monthlySales = recent.length / 3;
  const sellThrough = stock.length ? (monthlySales / stock.length) * 100 : null;
  const lines = orders.reduce((s, o) => s + (o.order_lines?.length ?? 0), 0);
  const perSale = lines ? orders.reduce((s, o) => s + Number(o.shipping_cost_cents) + Number(o.packaging_cost_cents), 0) / lines : null;

  const latest = new Map<string, number>();
  for (const r of rates ?? []) if (!latest.has(r.kind)) latest.set(r.kind, Number(r.rate_pct));
  const urssaf = (latest.get("urssaf_bic_vente") ?? 0) + (latest.get("cfp") ?? 0)
    + (org.versement_liberatoire ? latest.get("versement_liberatoire") ?? 0 : 0);
  // a category with a recurring charge is counted from it; its one-off expenses are its payments (no double count)
  const today = new Date(now).toISOString().slice(0, 10);
  const perMonth = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 } as Record<string, number>;
  const live = (recurring ?? []).filter((r) => !r.ends_on || r.ends_on >= today);
  const covered = new Set(live.map((r) => r.category as string));
  const monthlyOf = (cat?: string) => live.filter((r) => (cat ? r.category === cat : r.category !== "rent"))
    .reduce((a, r) => a + Number(r.amount_cents) * (perMonth[r.frequency] ?? 1), 0);
  const rent = monthlyOf("rent");
  const fixed = (expenses ?? []).filter((e) => !covered.has(e.category)).reduce((s, e) => s + Number(e.amount_cents), 0) / 3 + monthlyOf();

  basis.push(`${stock.length} articles en stock`);
  basis.push(`${recent.length} ventes sur 90 jours${recent.length < 5 ? " (prix moyen calculé sur toutes les ventes)" : ""}`);
  if (fixed > 0 || rent > 0) basis.push(`charges saisies (dépenses et charges récurrentes) : ${Math.round((fixed + rent) / 100)} € / mois`);

  return {
    basis,
    inputs: {
      ...DEFAULTS,
      stock: stock.length,
      cost: cost != null ? round(cost / 100, 0.5) : DEFAULTS.cost,
      price: price != null ? round(price / 100, 0.5) : DEFAULTS.price,
      sellThrough: sellThrough != null ? Math.min(100, round(sellThrough)) : DEFAULTS.sellThrough,
      feePct: Number(org.vinted_fee_pct),
      feeFixed: org.vinted_fee_fixed_cents / 100,
      perSale: perSale != null ? round(perSale / 100, 0.1) : DEFAULTS.perSale,
      urssafPct: urssaf || DEFAULTS.urssafPct,
      otherFixed: fixed > 0 ? round(fixed / 100, 10) : DEFAULTS.otherFixed,
      rent: rent > 0 ? round(rent / 100, 10) : DEFAULTS.rent,
    },
  };
}
