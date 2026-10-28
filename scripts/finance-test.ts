// Unit tests of the Financial Command Center calculations (src/lib/finance/calc.ts and insights.ts).
// Realistic hand-made data; every expected figure is worked out by hand in the comments.
// Run: npm run test:finance

import assert from "node:assert/strict";
import {
  cashPosition, capital, charges, evolution, forecast, immobilization, insights, liquidationValue, occurrences,
  performance, purchaseBudget, turnover,
} from "../src/lib/finance";
import type { Overview, Recurring } from "../src/lib/finance/types";
import { DEFAULTS, PRESETS, compute, funding } from "../src/lib/scenario";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};

const TODAY = "2026-10-28";
const rent: Recurring = { id: "r1", label: "Loyer atelier", category: "rent", amount_cents: 50000, frequency: "monthly", day_of_month: 5, starts_on: "2026-01-01", ends_on: null };
const soft: Recurring = { id: "r2", label: "Logiciel", category: "software", amount_cents: 1000, frequency: "weekly", day_of_month: 1, starts_on: "2026-10-01", ends_on: null };

function overview(patch: Partial<Overview> = {}): Overview {
  // 90 days of history: 2 items a day, 50 € net and 60 € gross a day, 25 € of cost of goods a day
  const daily = Array.from({ length: 90 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 6, 31 + i)).toISOString().slice(0, 10), net_cents: 5000, gross_cents: 6000, items: 2, cogs_cents: 2500,
  }));
  return {
    now: `${TODAY}T10:00:00Z`,
    settings: {
      cash_reserve_cents: 100000, liquidation_pct: 70, immob_levels: { normal: 40, high: 70, critical: 85 },
      aging_basis: "listed", aging_bounds: [30, 60, 90], dead_stock_days: 90,
      forecast: { window_days: 90, horizon_days: 90, growth_pct: 0, payout_days: 7, stock_target_days: 60, variable_cost_pct: 0, analysis_days: 30 },
      vinted_fee_pct: 5, vinted_fee_fixed_cents: 70, declaration_frequency: "monthly", versement_liberatoire: false, contribution_rate_pct: 12.4,
    },
    // declared on 20 October: 3 000 €
    balance: { as_of: "2026-10-20T08:00:00Z", amount_cents: 300000, note: null },
    ledger: { receipts_cents: 40000, refunds_cents: 2000, shipping_cents: 1000, purchases_cents: 20000,
      expenses_by_category: { rent: 50000, packaging: 3000 } },
    stock: {
      count: 200, cost_cents: 400000, priced_count: 180, price_cents: 1000000, unpriced_count: 20, unpriced_cost_cents: 30000,
      listed_count: 150, dormant_count: 30, dormant_cost_cents: 90000, dormant_price_cents: 150000,
      aging: [
        { from: 0, to: 30, count: 100, cost_cents: 180000 }, { from: 31, to: 60, count: 50, cost_cents: 90000 },
        { from: 61, to: 90, count: 20, cost_cents: 40000 }, { from: 91, to: null, count: 30, cost_cents: 90000 },
      ],
    },
    rejected: { count: 2, cost_cents: 3000 },
    receivable: { count: 3, amount_cents: 15000, oldest_sold_at: "2026-10-25T10:00:00Z" },
    unpaid_orders: [{ sold_at: "2026-10-25T10:00:00Z", amount_cents: 5000 }, { sold_at: "2026-10-27T10:00:00Z", amount_cents: 10000 }],
    periods: {
      days: 30,
      current: { items: 60, revenue_cents: 180000, cogs_cents: 75000, variable_cents: 15000, gross_profit_cents: 90000 },
      previous: { items: 50, revenue_cents: 150000, cogs_cents: 62000, variable_cents: 12000, gross_profit_cents: 76000 },
      year: { items: 600, revenue_cents: 1800000, cogs_cents: 750000, gross_profit_cents: 900000 },
      cashed_cents: 170000, expenses_by_category: { rent: 50000, packaging: 4000 }, first_sale_at: "2026-03-01T10:00:00Z", avg_days_to_sell: 40,
    },
    daily,
    monthly: [],
    cashed_months: [{ month: "2026-09", cents: 160000 }, { month: "2026-10", cents: 170000 }],
    snapshots: [],
    recurring: [rent],
    planned: [{ id: "p1", label: "Lot French Pick", amount_cents: 60000, due_on: "2026-11-10", supplier: null }],
    ...patch,
  };
}

test("occurrences : mensuel le 5, hebdomadaire, bornes exclues / incluses", () => {
  assert.deepEqual(occurrences(rent, "2026-10-04", "2026-12-05"), ["2026-10-05", "2026-11-05", "2026-12-05"]);
  assert.deepEqual(occurrences(rent, "2026-10-05", "2026-11-04"), []);
  assert.deepEqual(occurrences(soft, "2026-10-01", "2026-10-22"), ["2026-10-08", "2026-10-15", "2026-10-22"]);
  assert.deepEqual(occurrences({ ...rent, ends_on: "2026-11-01" }, "2026-10-01", "2026-12-31"), ["2026-10-05"]);
  assert.deepEqual(occurrences({ ...rent, frequency: "quarterly", day_of_month: 28 }, "2026-01-01", "2026-12-31"), ["2026-01-28", "2026-04-28", "2026-07-28", "2026-10-28"]);
});

test("charges : une catégorie récurrente n'est pas comptée deux fois", () => {
  // the 500 € rent of 5 October is counted once, the one-off rent entry is its payment; packaging 30 € is added
  const c = charges([rent], { rent: 50000, packaging: 3000 }, "2026-10-01", "2026-10-28");
  assert.equal(c.byCategory.rent, 50000);
  assert.equal(c.byCategory.packaging, 3000);
  assert.equal(c.total, 53000);
});

test("trésorerie : solde déclaré + encaissements − sorties depuis", () => {
  // 3 000 + 400 − 20 − 10 − 200 − 30 (packaging) = 3 140 € ; no rent between 20 and 28 October (rent on the 5th)
  const cash = cashPosition(overview(), TODAY);
  assert.equal(cash.known, true);
  assert.equal(cash.cents, 314000);
  assert.equal(cash.staleDays, 8);
});

test("trésorerie inconnue sans solde déclaré", () => {
  const cash = cashPosition(overview({ balance: null, ledger: null }), TODAY);
  assert.equal(cash.known, false);
  assert.equal(cash.cents, null);
});

test("capital : cash + stock au coût + à recevoir, sans double compte du dormant", () => {
  const o = overview();
  const cap = capital(o, cashPosition(o, TODAY));
  // 3 140 + 4 000 + 150 = 7 290 €
  assert.equal(cap.total, 729000);
  assert.equal(cap.stockActive + cap.dormant, cap.stock);
  const shares = cap.parts.reduce((a, p) => a + p.share, 0);
  assert.ok(Math.abs(shares - 100) < 1e-9, String(shares));
  assert.equal(cap.parts.find((p) => p.key === "dormant")!.cents, 90000);
});

test("capital : une trésorerie estimée négative compte 0", () => {
  const o = overview({ balance: { as_of: "2026-10-20T08:00:00Z", amount_cents: -100000, note: null } });
  const cap = capital(o, cashPosition(o, TODAY));
  assert.equal(cap.cash, 0);
  assert.equal(cap.total, 400000 + 15000);
});

test("immobilisation : part du stock dans le capital et niveau", () => {
  const imm = immobilization(400000, 729000, { normal: 40, high: 70, critical: 85 });
  assert.ok(Math.abs(imm.share! - 54.87) < 0.01);
  assert.equal(imm.level, "normal");
  assert.equal(immobilization(800, 1000, { normal: 40, high: 70, critical: 85 }).level, "élevé");
  assert.equal(immobilization(900, 1000, { normal: 40, high: 70, critical: 85 }).level, "critique");
  assert.equal(immobilization(0, 0, { normal: 40, high: 70, critical: 85 }).level, null);
});

test("liquidation : prix affiché × facteur + coût des articles sans prix", () => {
  // 10 000 € × 70 % + 300 € = 7 300 €
  assert.equal(liquidationValue(1000000, 30000, 70), 730000);
  assert.equal(liquidationValue(1000000, 0, 100), 1000000);
});

test("performance : marge brute, cotisations, charges, bénéfice", () => {
  const p = performance(overview(), TODAY);
  // contributions 12.4 % × 1 700 = 210,80 € ; charges on 30 days: rent of 5 October 500 € + packaging 40 € ; 900 − 210,80 − 540 = 149,20 €
  assert.equal(p.contributions, 21080);
  assert.equal(p.charges, 54000);
  assert.equal(p.net, 90000 - 21080 - 54000);
  assert.equal(p.grossPct, 50);
});

test("rotation et vitesse du capital", () => {
  const o = overview();
  const cash = cashPosition(o, TODAY);
  const cap = capital(o, cash);
  const t = turnover(o, performance(o, TODAY), cap, TODAY);
  // cost of goods 750 € over 30 days → 750 € a month ; stock 4 000 € → 0,1875× a month ; 160 days of stock
  assert.equal(t.monthly, 0.1875);
  assert.equal(Math.round(t.daysOfStock!), 160);
  assert.equal(t.yearlyMeasured, false); // first sale in March: less than a year
  assert.equal(t.yearly, (2500 * 365) / 400000);
  // gross 900 € / 30 days → 10 950 € a year ; / 4 000 € = 2,7375 € of margin per euro of stock and per year
  assert.equal(t.velocity, (90000 * 365 / 30) / 400000);
  // same margin on a stock four times smaller: capital four times faster
  const small = overview({ stock: { ...o.stock, cost_cents: 100000 } });
  const t2 = turnover(small, performance(small, TODAY), capital(small, cash), TODAY);
  assert.equal(t2.velocity! / t.velocity!, 4);
});

test("rotation : le stock moyen vient des relevés quand il y en a", () => {
  const o = overview({ snapshots: [
    { day: "2026-10-10", cash_cents: 1, stock_cost_cents: 300000, dormant_cost_cents: 0, receivable_cents: 0 },
    { day: "2026-10-20", cash_cents: 1, stock_cost_cents: 500000, dormant_cost_cents: 0, receivable_cents: 0 },
  ] });
  const t = turnover(o, performance(o, TODAY), capital(o, cashPosition(o, TODAY)), TODAY);
  assert.equal(t.avgFromSnapshots, true);
  assert.equal(t.avgStock, 400000);
});

test("évolution du capital contre un relevé d'il y a 30 jours", () => {
  const o = overview({ snapshots: [
    { day: "2026-09-25", cash_cents: 200000, stock_cost_cents: 350000, dormant_cost_cents: 0, receivable_cents: 10000 },
    { day: "2026-10-26", cash_cents: 1, stock_cost_cents: 1, dormant_cost_cents: 0, receivable_cents: 0 },
  ] });
  const ev = evolution(o, 729000, TODAY)!;
  assert.equal(ev.since, "2026-09-25");
  assert.equal(ev.was, 560000);
  assert.equal(ev.delta, 169000);
  assert.equal(evolution(overview(), 729000, TODAY), null);
});

test("prévision : encaissements, charges, achats prévus, cotisations, stock limité", () => {
  const o = overview();
  const cash = cashPosition(o, TODAY);
  const fc = forecast(o, cash, TODAY);
  assert.equal(fc.points.length, 91);
  assert.equal(fc.points[0].base, 314000);
  // receivables: 50 € on 1 Nov (sold 25 Oct + 7), 100 € on 3 Nov
  assert.equal(fc.points.find((p) => p.day === "2026-11-01")!.inflow >= 5000, true);
  // 2 items a day for 200 items in stock: stock runs out after 100 days → beyond the 90-day horizon
  assert.equal(fc.stockOutDay, null);
  // first sales cash arrives on day 8 (sold tomorrow + 7 days)
  assert.equal(fc.points[7].inflow, 0 + (fc.points[7].day === "2026-11-04" ? 0 : 0));
  assert.equal(fc.points[8].inflow, 5000);
  // outflows listed: rent (3 dates), planned purchase, contributions
  const labels = fc.outflows.map((x) => x.label);
  assert.ok(labels.includes("Loyer") && labels.includes("Achats prévus") && labels.includes("Cotisations URSSAF"), labels.join());
  // September contributions (12.4 % × 1 600 = 198,40 €) are due on 31 October
  const oct31 = fc.points.find((p) => p.day === "2026-10-31")!;
  assert.equal(oct31.outflow, 19840);
  // low < base < high once sales come in
  const last = fc.points[90];
  assert.ok(last.low < last.base && last.base < last.high);
});

test("prévision : le stock limite les ventes", () => {
  const o = overview({ stock: { ...overview().stock, count: 20 } });
  const fc = forecast(o, cashPosition(o, TODAY), TODAY);
  // 2 items a day, 20 in stock: out on day 11
  assert.equal(fc.stockOutDay, "2026-11-08");
  const after = fc.points.filter((p) => p.day > "2026-11-20").reduce((a, p) => a + p.inflow, 0);
  assert.equal(after, 0);
});

test("budget d'achat : jamais la réserve, engagés déduits, plafonné au stock nécessaire", () => {
  const o = overview();
  const cash = cashPosition(o, TODAY);
  const fc = forecast(o, cash, TODAY);
  const b = purchaseBudget(o, cash, fc, TODAY);
  assert.equal(b.committed, 60000);
  // max = cash + receivables − 30-day dues − committed − reserve
  const due30 = fc.points.filter((p) => p.day > TODAY && p.day <= "2026-11-27").reduce((a, p) => a + p.outflow, 0) - 60000;
  assert.equal(b.max, Math.max(0, 314000 + 15000 - due30 - 60000 - 100000));
  // stock needed: 25 € a day × 90 days = 2 250 € < 4 000 € in stock → nothing to buy
  assert.equal(b.need, 0);
  assert.equal(b.recommended, 0);
  assert.ok(b.recommended <= b.max);
  // with little stock, the need wins over the cash limits
  const lean = overview({ stock: { ...o.stock, cost_cents: 100000, count: 50 } });
  const fc2 = forecast(lean, cashPosition(lean, TODAY), TODAY);
  const b2 = purchaseBudget(lean, cashPosition(lean, TODAY), fc2, TODAY);
  assert.equal(b2.need, 2500 * 90 - 100000);
  assert.ok(b2.recommended <= b2.need! && b2.recommended <= b2.max);
});

test("budget d'achat : aucun budget sans trésorerie déclarée", () => {
  const o = overview({ balance: null, ledger: null });
  const cash = cashPosition(o, TODAY);
  const b = purchaseBudget(o, cash, forecast(o, cash, TODAY), TODAY);
  assert.equal(b.recommended, 0);
  assert.equal(b.known, false);
});

test("recommandations : jamais sans assez de données", () => {
  const o = overview();
  const cash = cashPosition(o, TODAY);
  const cap = capital(o, cash);
  const perf = performance(o, TODAY);
  const fc = forecast(o, cash, TODAY);
  const seg = (name: string, sold: number, margin: number, cost: number, days: number | null = null) =>
    ({ name, items: sold + 2, sold, stock: 2, avg_cost_cents: 1000, avg_price_cents: 3000, revenue_cents: margin + cost, margin_cents: margin,
       sold_cost_cents: cost, avg_days: days, timed: days == null ? 0 : sold, stock_cost_cents: 2000 });
  const base = { o, cap, perf, turn: turnover(o, perf, cap, TODAY), fc, budget: purchaseBudget(o, cash, fc, TODAY), today: TODAY };
  const few = insights({ ...base, brands: [seg("Harris Tweed", 3, 9000, 1000)], categories: [], sizes: [] });
  assert.ok(!few.list.some((i) => i.id.startsWith("brand")));
  assert.ok(few.missing.some((m) => m.includes("pas assez de données")));
  // Harris Tweed 6 000 € of margin for 1 000 € invested vs 1 000 € for 1 000 € → far above average
  const rich = insights({ ...base, brands: [seg("Harris Tweed", 8, 600000, 100000), seg("Zara", 10, 100000, 100000)],
    categories: [], sizes: [seg("46", 6, 1, 1, 60), seg("52", 6, 1, 1, 30)] });
  const best = rich.list.find((i) => i.id === "brand-best")!;
  assert.ok(best && best.text.includes("Harris Tweed"), JSON.stringify(rich.list));
  assert.ok(rich.list.find((i) => i.id === "sizes")!.text.includes("100 %"));
  assert.ok(rich.list.some((i) => i.id === "dormant"));
});

test("scénarios : cash nécessaire, retour sur capital et scénarios types", () => {
  // 200 articles à 15 €, 25 % vendus par mois à 45 €, 50 € de charges fixes, stock constant
  const s = { ...DEFAULTS, stock: 200, growth: 0 };
  const r = compute(s), f = funding(s, new Date("2026-10-28"));
  assert.equal(r.capital, 3000);
  assert.equal(f.dip, 0); // profitable and constant stock: the cash curve never dips
  assert.equal(f.cashNeeded, 3000 + r.fixed);
  assert.ok(Math.abs(f.rocPct! - (r.annualNet / f.cashNeeded) * 100) < 1e-9);
  assert.ok(Math.abs(f.velocity! - (r.gross * 12) / 3000) < 1e-9);
  // growing 30 % a month, bought out of a small profit (≈ 224 € a month for 900 € of extra stock): a dip appears and is added to the cash needed
  const g = funding({ ...s, growth: 30, otherFixed: 800 }, new Date("2026-10-28"));
  assert.ok(g.dip > 0 && g.cashNeeded > f.cashNeeded);
  const [cons, base, aggr] = PRESETS.map((p) => p.apply(s));
  assert.deepEqual(base, s);
  assert.equal(cons.sellThrough, 19); // 25 × 0,75 = 18,75 → rounded to the half point
  assert.equal(cons.growth, 0);
  assert.equal(aggr.sellThrough, 30);
  assert.equal(aggr.growth, 5);
  assert.ok(compute(cons).net < compute(base).net && compute(base).net < compute(aggr).net);
});

console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
