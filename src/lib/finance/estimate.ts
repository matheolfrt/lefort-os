// Mon argent — the purchase prices that were never entered. An import puts 0 or 1 € on a piece: the stock then looks
// worth nothing, the margin looks like the whole sale price, and the purchase budget says there is nothing to buy.
// estimateCosts() counts those pieces at the assumed price of their type (the same rule as the Indicateurs page) and
// says how many pieces and how much it changes. monthlyPnl() is the profit month by month on the same basis.
// Pure functions, tested in scripts/finance-test.ts.

import { costUsed, familyOf } from "../kpi/classify";
import { charges, parisDay } from "./calc";
import type { Cents, CostEstimate, Overview } from "./types";

interface Described { title: string | null; brand: string | null; category: string | null; cost: Cents }
/** A piece in stock: its age in whole days (on the basis chosen in the settings) and whether it has a price */
export interface StockCostRow extends Described { age: number; priced: boolean }
/** A sale: `inDaily` when it is one of the sales the forecast counts day by day (not an imported old sale) */
export interface SoldCostRow extends Described { soldAt: string; revenue: Cents; variable: Cents; inDaily: boolean }
export interface ExpenseRow { spentOn: string; category: string; cents: Cents }

const DAY = 86_400_000;
/** Above this share of sales without a real purchase price, returns by brand or category are not compared */
export const RELIABLE_SHARE = 0.3;

/** What the assumed price adds to the recorded one (0 when the price was really entered) */
function extraOf(r: Described): number {
  const used = costUsed(r.cost, familyOf(r), r.title);
  return used.estimated ? Math.max(0, used.cents - r.cost) : 0;
}

export function estimateCosts(o: Overview, stock: StockCostRow[], sold: SoldCostRow[]): Overview {
  const now = new Date(o.now).getTime();
  const days = o.periods.days;
  const [b1, b2] = o.settings.aging_bounds, dead = o.settings.dead_stock_days;
  const est: CostEstimate = {
    stockCount: 0, stockRecorded: 0, stockExtra: 0, dormantExtra: 0, periodCount: 0, periodRecorded: 0, periodExtra: 0,
    yearCount: 0, yearSold: o.periods.year.items, yearExtra: 0, reliable: true,
  };

  const aging = o.stock.aging.map((b) => ({ ...b }));
  let unpricedExtra = 0;
  for (const r of stock) {
    const extra = extraOf(r);
    if (!extra) continue;
    est.stockCount++; est.stockRecorded += r.cost; est.stockExtra += extra;
    if (!r.priced) unpricedExtra += extra;
    if (r.age > dead) est.dormantExtra += extra;
    const bucket = aging[r.age <= b1 ? 0 : r.age <= b2 ? 1 : r.age <= dead ? 2 : 3];
    if (bucket) bucket.cost_cents += extra;
  }

  let prevExtra = 0;
  const dailyExtra = new Map<string, number>();
  for (const r of sold) {
    const extra = extraOf(r);
    if (!extra) continue;
    const t = new Date(r.soldAt).getTime();
    if (t > now - 365 * DAY) { est.yearCount++; est.yearExtra += extra; }
    if (t > now - days * DAY) { est.periodCount++; est.periodRecorded += r.cost; est.periodExtra += extra; }
    else if (t > now - 2 * days * DAY) prevExtra += extra;
    if (r.inDaily) { const d = parisDay(r.soldAt); dailyExtra.set(d, (dailyExtra.get(d) ?? 0) + extra); }
  }
  est.reliable = est.yearSold === 0 || est.yearCount / est.yearSold < RELIABLE_SHARE;

  const period = (p: Overview["periods"]["current"], extra: number) => ({ ...p, cogs_cents: p.cogs_cents + extra, gross_profit_cents: p.gross_profit_cents - extra });
  return {
    ...o,
    stock: {
      ...o.stock, cost_cents: o.stock.cost_cents + est.stockExtra, unpriced_cost_cents: o.stock.unpriced_cost_cents + unpricedExtra,
      dormant_cost_cents: o.stock.dormant_cost_cents + est.dormantExtra, aging,
    },
    periods: { ...o.periods, current: period(o.periods.current, est.periodExtra), previous: period(o.periods.previous, prevExtra), year: period(o.periods.year, est.yearExtra) },
    daily: o.daily.map((d) => (dailyExtra.has(d.day) ? { ...d, cogs_cents: Number(d.cogs_cents) + dailyExtra.get(d.day)! } : d)),
    // the past statements were recorded without the assumed prices: the same pieces were mostly there, so they get the
    // same addition and the evolution compares like with like
    snapshots: o.snapshots.map((s) => ({ ...s, stock_cost_cents: s.stock_cost_cents + est.stockExtra, dormant_cost_cents: s.dormant_cost_cents + est.dormantExtra })),
    estimate: est,
  };
}

// ───────────────────────── Month by month ─────────────────────────

export interface MonthPnl {
  month: string; // YYYY-MM (Paris)
  items: number; revenue: Cents; cogs: Cents; variable: Cents; gross: Cents; contributions: Cents; charges: Cents; net: Cents;
  /** sales of the month whose purchase price is assumed */
  estimated: number;
  /** the month is not over */
  partial: boolean;
}

const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).toISOString().slice(0, 10);

/**
 * Profit of each of the last `n` months, the current one included (up to today): sales, minus the purchase price of the
 * pieces sold, the fees, the contributions (rate × sales of the month) and the charges of the month.
 */
export function monthlyPnl(o: Overview, sold: SoldCostRow[], expenses: ExpenseRow[], today: string, n = 12): MonthPnl[] {
  const [y, m] = today.split("-").map(Number);
  const out: MonthPnl[] = [];
  const by = new Map<string, MonthPnl>();
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    const month = d.toISOString().slice(0, 7);
    const row: MonthPnl = { month, items: 0, revenue: 0, cogs: 0, variable: 0, gross: 0, contributions: 0, charges: 0, net: 0, estimated: 0, partial: k === 0 };
    out.push(row); by.set(month, row);
  }
  for (const r of sold) {
    const row = by.get(parisDay(r.soldAt).slice(0, 7));
    if (!row) continue;
    const used = costUsed(r.cost, familyOf(r), r.title);
    row.items++; row.revenue += r.revenue; row.cogs += used.cents; row.variable += r.variable;
    if (used.estimated) row.estimated++;
  }
  const rate = o.settings.contribution_rate_pct / 100;
  for (const row of out) {
    const [yy, mm] = row.month.split("-").map(Number);
    const from = lastDay(yy, mm - 2), end = lastDay(yy, mm - 1);
    const to = end > today ? today : end;
    const oneOff: Record<string, Cents> = {};
    for (const e of expenses) if (e.spentOn > from && e.spentOn <= to) oneOff[e.category] = (oneOff[e.category] ?? 0) + e.cents;
    row.gross = row.revenue - row.cogs - row.variable;
    row.contributions = Math.round(row.revenue * rate);
    row.charges = charges(o.recurring, oneOff, from, to).total;
    row.net = row.gross - row.contributions - row.charges;
  }
  return out;
}

/** The best and the worst full month, and the average of the full months that had sales */
export function pnlSummary(months: MonthPnl[]) {
  const full = months.filter((r) => !r.partial && r.items > 0);
  if (!full.length) return null;
  const sorted = [...full].sort((a, b) => b.net - a.net);
  return {
    best: sorted[0], worst: sorted[sorted.length - 1], count: full.length,
    avgNet: Math.round(full.reduce((s, r) => s + r.net, 0) / full.length),
    totalNet: months.reduce((s, r) => s + r.net, 0), totalRevenue: months.reduce((s, r) => s + r.revenue, 0),
  };
}
