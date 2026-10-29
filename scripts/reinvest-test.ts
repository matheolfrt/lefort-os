// Unit tests of the reinvestment simulator (src/lib/reinvest.ts).
// Run: npm run test:reinvest
import assert from "node:assert/strict";
import { DEFAULTS, type ScenarioInputs } from "../src/lib/scenario";
import { prudent, reinvest } from "../src/lib/reinvest";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};
const close = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
// 100 blazers bought 15 €, sold 45 €, 30 % of the stock sold each month, no fees or charges: easy to follow by hand
const simple: ScenarioInputs = { ...DEFAULTS, stock: 100, cost: 15, price: 45, sellThrough: 30, feePct: 0, feeFixed: 0, perSale: 0,
  urssafPct: 0, otherFixed: 0, rent: 0, employees: 0 };
const from = new Date(Date.UTC(2026, 9, 29));

test("sans réinvestir : le stock reste au même niveau, le CA aussi", () => {
  const r = reinvest(simple, { now: 0, monthly: 0, profitPct: 0 }, 12, from);
  for (const m of r.months) { close(m.stock, 100); close(m.revenue, 30 * 45); close(m.net, 30 * 30); }
  assert.equal(r.invested, 0);
  assert.equal(r.perEuro, null);
  assert.equal(r.months[0].month, "2026-11");
});

test("300 € réinvestis maintenant : 20 vestes de plus, en vente le mois suivant", () => {
  const r = reinvest(simple, { now: 300, monthly: 0, profitPct: 0 }, 12, from);
  close(r.months[0].stock, 100, 1e-9);           // bought in month 1, prepared, not on sale yet
  close(r.months[0].arriving, 30 + 20);          // 30 bought again + 20 extra
  close(r.months[1].stock, 120);                 // on sale from month 2
  close(r.months[1].revenue, 36 * 45);           // 30 % of 120
  // the stock stays at 120: what sells is bought again
  close(r.months[11].stock, 120);
  assert.equal(r.invested, 300);
  // 11 months × 6 more sales × 30 € of margin
  close(r.extraNet, 11 * 6 * 30);
  close(r.extraStockValue, 300, 1e-6);           // the 20 blazers are still there (bought again each time they sell)
  close(r.perEuro!, (1980 + 300) / 300);
});

test("une part du bénéfice réinvestie chaque mois : le CA grandit de mois en mois", () => {
  const r = reinvest(simple, { now: 0, monthly: 0, profitPct: 50 }, 12, from);
  assert.equal(r.months[0].invested, 0, "pas de bénéfice avant le premier mois");
  close(r.months[1].invested, 450);              // half of 900 €
  for (let i = 2; i < 12; i++) assert.ok(r.months[i].revenue > r.months[i - 1].revenue, `mois ${i + 1}`);
  assert.ok(r.months[11].revenue > r.base[11].revenue * 1.5);
});

test("jamais une part d'une perte", () => {
  const losing = { ...simple, otherFixed: 5000 };
  const r = reinvest(losing, { now: 0, monthly: 0, profitPct: 50 }, 6, from);
  assert.ok(r.months.every((m) => m.invested === 0));
});

test("somme chaque mois + vue prudente plus basse", () => {
  const plan = { now: 0, monthly: 150, profitPct: 0 };
  const r = reinvest(simple, plan, 12, from);
  close(r.invested, 1800);
  const p = reinvest(prudent(simple), plan, 12, from);
  assert.ok(p.months[11].revenue < r.months[11].revenue);
  assert.ok(r.peakArrivals >= r.months[11].arriving - 1e-9);
});

console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
