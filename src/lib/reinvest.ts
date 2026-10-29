// « Si je réinvestis tant, combien de CA par mois dans 3 mois, 6 mois, un an ? »
// A month-by-month stock model on the business's own figures (scenario inputs): every month a share of the stock sells,
// what sold is bought again (the stock stays level), and the money reinvested buys extra stock, which sells the same
// way. What is bought in a month is received and prepared that month, and on sale the next (reception, photos,
// listing). Compared month by month with the same
// business without reinvesting. Pure functions, shared by the page and its tests.

import { compute, type ScenarioInputs } from "@/lib/scenario";

export interface ReinvestPlan {
  now: number;         // € reinvested once, at the start
  monthly: number;     // € added every month
  profitPct: number;   // % of the previous month's profit put back into stock
}

export interface ReinvestMonth {
  i: number;            // 1 = next month
  month: string;        // YYYY-MM
  stock: number;        // items on sale during the month
  sales: number;
  revenue: number;      // €
  net: number;          // € after purchases of what sold, fees, contributions, fixed charges
  invested: number;     // € of extra stock bought this month
  arriving: number;     // items received this month (to prepare and list)
}

export interface ReinvestResult {
  months: ReinvestMonth[];   // with the plan
  base: ReinvestMonth[];     // the same business without reinvesting
  invested: number;          // € reinvested over the period
  extraNet: number;          // € of extra profit over the period, against no reinvestment
  extraStockValue: number;   // € (at cost) of extra stock still there at the end: money not lost, still to sell
  perEuro: number | null;    // extra profit + extra stock left, per € reinvested
  peakArrivals: number;      // most items to prepare in a month
}

const ym = (from: Date, i: number) => {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth() + i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function run(s: ScenarioInputs, plan: ReinvestPlan, months: number, from: Date): ReinvestMonth[] {
  const st = Math.max(0, Math.min(100, s.sellThrough)) / 100;
  const cost = Math.max(0.01, s.cost);
  let stock = Math.max(0, s.stock);
  let lastNet = 0;
  const out: ReinvestMonth[] = [];
  for (let i = 1; i <= months; i++) {
    const sales = stock * st;
    const r = compute({ ...s, stock, growth: 0 });
    // = revenue − purchases of what sold − fees − per-sale costs − contributions − fixed charges
    const net = r.net;
    // money put into extra stock this month (never a share of a loss)
    const invested = Math.max(0, (i === 1 ? plan.now : 0) + plan.monthly + (plan.profitPct / 100) * Math.max(0, lastNet));
    // bought this month (what sold, bought again, and the extra stock): received and prepared, on sale next month
    const arriving = sales + invested / cost;
    out.push({ i, month: ym(from, i), stock, sales, revenue: r.revenue, net, invested, arriving });
    stock = stock - sales + arriving;
    lastNet = net;
  }
  return out;
}

export function reinvest(s: ScenarioInputs, plan: ReinvestPlan, months = 12, from = new Date()): ReinvestResult {
  const withPlan = run(s, plan, months, from);
  const base = run(s, { now: 0, monthly: 0, profitPct: 0 }, months, from);
  const invested = withPlan.reduce((a, m) => a + m.invested, 0);
  // the money reinvested is not spent: it became stock. The profit is compared before it, month by month
  const extraNet = withPlan.reduce((a, m) => a + m.net, 0) - base.reduce((a, m) => a + m.net, 0);
  // the stock left at the end (what did not sell, plus the last purchases), above the base, at cost
  const end = (m?: ReinvestMonth) => (m ? m.stock - m.sales + m.arriving : 0);
  const extraStockValue = Math.max(0, (end(withPlan.at(-1)) - end(base.at(-1))) * s.cost);
  return {
    months: withPlan, base, invested, extraNet, extraStockValue,
    perEuro: invested > 0 ? (extraNet + extraStockValue) / invested : null,
    peakArrivals: Math.max(0, ...withPlan.map((m) => m.arriving)),
  };
}

/** The prudent view: fewer sales and a lower price, as in the « Conservateur » scenario */
export const prudent = (s: ScenarioInputs): ScenarioInputs => ({ ...s, sellThrough: s.sellThrough * 0.75, price: s.price * 0.95 });

export const HORIZONS = [3, 6, 12] as const;
