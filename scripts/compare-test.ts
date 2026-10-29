// Unit tests of the comparisons (src/lib/compare.ts) and of « Ma journée » (src/lib/day-brief.ts).
// Run: npm run test:compare
import assert from "node:assert/strict";
import { compareAll, gap, monthsBack, type SoldRow } from "../src/lib/compare";
import { dayBrief, joinFr } from "../src/lib/day-brief";
import type { GoalProgress } from "../src/lib/goals";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};
const n = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");
const sale = (day: string, revenue = 5000, costs = 2000, delay: number | null = 10): SoldRow => ({ day, revenue, costs, delay });

test("le même jour, des mois plus tôt (les mois courts s'arrêtent à leur dernier jour)", () => {
  assert.equal(monthsBack("2026-10-29", 1), "2026-09-29");
  assert.equal(monthsBack("2026-10-31", 1), "2026-09-30");
  assert.equal(monthsBack("2026-03-31", 1), "2026-02-28");
  assert.equal(monthsBack("2026-01-15", 2), "2025-11-15");
});

test("mois en cours contre les mêmes jours du mois dernier, jamais le mois entier", () => {
  const sold = [
    sale("2026-10-01"), sale("2026-10-10"), sale("2026-10-29"), sale("2026-10-30"), // the 30th is tomorrow: not sold yet in the test
    sale("2026-09-05"), sale("2026-09-30"),                                          // 30 Sept is after the 29th: left out
  ];
  const c = compareAll({ today: "2026-10-29", sold: sold.filter((s) => s.day <= "2026-10-29"), orders: [], cash: [], ratePct: 0 });
  assert.equal(c.sales.cur, 3);
  assert.equal(c.sales.prev!.value, 1, "seulement du 1er au 29 septembre");
  assert.match(c.sales.prev!.detail, /du 1er au 29 septembre/);
  assert.equal(c.sales.better, "up");
});

test("moyenne des 3 mois : mois par mois pour les totaux, chaque vente pèse pareil pour les moyennes", () => {
  const orders = [
    { day: "2026-07-02", gross: 1000 }, { day: "2026-07-03", gross: 1000 }, { day: "2026-07-04", gross: 1000 },
    { day: "2026-08-02", gross: 4000 },
    { day: "2026-09-02", gross: 2000 },
    { day: "2026-10-02", gross: 3000 },
  ];
  const c = compareAll({ today: "2026-10-29", sold: [], orders, cash: [], ratePct: 0 });
  assert.equal(c.basket.cur, 3000);
  assert.equal(c.basket.prev!.value, 2000);
  assert.equal(c.basket.avg!.value, 9000 / 5, "panier : 5 commandes en tout, pas la moyenne de 3 moyennes");
  assert.equal(c.basket.avg!.label, "moy. 3 mois");
  assert.ok(c.basket.sample);
});

test("encaissé : remboursements déduits, totaux moyennés mois par mois", () => {
  const cash = [
    { day: "2026-10-03", cents: 10000 }, { day: "2026-10-04", cents: -2000 },
    { day: "2026-09-03", cents: 6000 }, { day: "2026-08-03", cents: 3000 }, { day: "2026-07-03", cents: 0 },
  ];
  const c = compareAll({ today: "2026-10-29", sold: [], orders: [], cash, ratePct: 0 });
  assert.equal(c.cashed.cur, 8000);
  assert.equal(c.cashed.prev!.value, 6000);
  assert.equal(c.cashed.avg!.value, 3000);
});

test("bénéfice après cotisations, comme le tableau du mois", () => {
  const c = compareAll({ today: "2026-10-29", sold: [sale("2026-10-05", 10000, 4000), sale("2026-10-06", 5000, 1000)], orders: [], cash: [], ratePct: 12.3 });
  assert.equal(c.profit.cur, 15000 - 5000 - Math.round(15000 * 0.123));
});

test("une activité récente : les mois d'avant n'existaient pas, ce ne sont pas des zéros", () => {
  const sold = [sale("2026-09-10"), sale("2026-10-10")];
  const c = compareAll({ today: "2026-10-29", sold, orders: [], cash: [], ratePct: 0, since: "2026-09-10" });
  assert.equal(c.sales.prev!.value, 1);
  assert.equal(c.sales.avg, null, "un seul mois avant : pas de moyenne");
  const c2 = compareAll({ today: "2026-10-29", sold, orders: [], cash: [], ratePct: 0, since: "2026-10-01" });
  assert.equal(c2.sales.prev, null);
});

test("délai de vente : 90 jours glissants comparés à eux-mêmes un mois plus tôt, plus court = mieux", () => {
  const sold = [sale("2026-10-20", 1, 0, 10), sale("2026-09-20", 1, 0, 30), sale("2026-06-01", 1, 0, 100)];
  const c = compareAll({ today: "2026-10-29", sold, orders: [], cash: [], ratePct: 0 });
  assert.equal(c.delay.cur, 20, "les 90 derniers jours : 10 et 30 jours");
  assert.equal(c.delay.prev!.value, 30, "au 29 septembre : seulement la vente du 20 sept. (le 1er juin est trop ancien)");
  assert.equal(c.delay.better, "down");
  const g = gap(c.delay.cur, c.delay.prev, "down")!;
  assert.equal(g.verdict, "below");
  assert.equal(g.good, true, "en dessous, et c'est une bonne nouvelle");
});

test("courbes : 30 jours, le dernier point est aujourd'hui", () => {
  const c = compareAll({ today: "2026-10-29", sold: [sale("2026-10-29"), sale("2026-09-30"), sale("2026-09-29")], orders: [], cash: [], ratePct: 0 });
  assert.equal(c.sales.spark.length, 30);
  assert.equal(c.sales.spark.at(-1), 1);
  assert.equal(c.sales.spark[0], 1, "le 30 septembre est le premier des 30 jours");
  assert.equal(c.basket.spark.at(-1), null, "pas de commande : pas de point inventé");
});

test("écart : au-dessus, en dessous, au même niveau, et rien de bon ni de mauvais sur un petit échantillon", () => {
  const ref = { value: 100, n: 20, label: "sept.", detail: "" };
  assert.deepEqual(gap(118, ref, "up"), { verdict: "above", good: true, pct: 0.18, diff: 18 });
  assert.equal(gap(80, ref, "up")!.good, false);
  assert.equal(gap(101, ref, "up")!.verdict, "same");
  assert.equal(gap(101, ref, "up")!.good, null);
  assert.equal(gap(150, ref, "up", false)!.good, null);
  const zero = gap(5, { ...ref, value: 0 }, "up")!;
  assert.equal(zero.pct, null);
  assert.equal(zero.verdict, "above");
  assert.equal(gap(null, ref, "up"), null);
});

// ── « Ma journée »
const days = (rows: [number, number][]) => rows.map(([sales, revenue], i) => ({
  day: `2026-10-${String(i + 1).padStart(2, "0")}`, sales, listed: 0, revenue_cents: revenue,
}));
const progress = (d: GoalProgress["days"], goals: GoalProgress["goals"] = [], month = { sales: 0, revenue_cents: 0, listed: 0 }): GoalProgress => ({
  now: "2026-10-29T10:00:00+01:00", manager: true, days: d, goals,
  periods: {
    day: { starts: "2026-10-29T00:00:00+01:00", ends: "2026-10-30T00:00:00+01:00", sales: 0, listed: 0, revenue_cents: 0, prev: { sales: 0, listed: 0, revenue_cents: 0 } },
    week: { starts: "2026-10-26T00:00:00+01:00", ends: "2026-11-02T00:00:00+01:00", sales: 0, listed: 0, revenue_cents: 0, prev: { sales: 0, listed: 0, revenue_cents: 0 } },
    month: { starts: "2026-10-01T00:00:00+02:00", ends: "2026-11-01T00:00:00+01:00", ...month, prev: { sales: 0, listed: 0, revenue_cents: 0 } },
    year: { starts: "2026-01-01T00:00:00+01:00", ends: "2027-01-01T00:00:00+01:00", sales: 0, listed: 0, revenue_cents: 0, prev: { sales: 0, listed: 0, revenue_cents: 0 } },
  },
});

test("Ma journée : hier contre la journée habituelle, puis ce qu'aujourd'hui demande", () => {
  // 28 ordinary days at 2 sales / 100 €, yesterday 6 sales / 312 €, today nothing yet
  const d = days([...Array(28).fill([2, 10000]), [6, 31200], [0, 0]] as [number, number][]);
  const b = dayBrief({ progress: progress(d), ship: 4, publish: 12, prices: 3, manager: true });
  assert.deepEqual(b.yesterday.map((x) => n([x.text, x.note].filter(Boolean).join(" "))), ["6 ventes, 312 €", "↑ 212 % au-dessus de votre moyenne (100 € par jour)"]);
  assert.equal(b.yesterday[1].tone, "good");
  assert.deepEqual(b.today.map((x) => n(x.text)), ["4 commandes à expédier", "12 articles prêts à publier", "3 prix à baisser"]);
  assert.equal(joinFr(b.today.map((x) => n(x.text))), "4 commandes à expédier, 12 articles prêts à publier et 3 prix à baisser");
});

test("Ma journée : sans argent pour l'équipe, et le rythme de l'objectif du mois", () => {
  const d = days([...Array(28).fill([2, 10000]), [1, 5000], [1, 4000]] as [number, number][]).map((x) => ({ ...x, revenue_cents: null }));
  const p = progress(d, [{ period: "month", metric: "sales", target: 60 }], { sales: 50, revenue_cents: null as unknown as number, listed: 0 });
  const b = dayBrief({ progress: { ...p, manager: false }, ship: 0, publish: 0, prices: 3, manager: false });
  assert.deepEqual(b.yesterday.map((x) => n([x.text, x.note].filter(Boolean).join(" "))), ["1 vente", "↓ 50 % en dessous de votre moyenne (2 ventes par jour)"]);
  assert.equal(b.yesterday[1].tone, "bad");
  assert.ok(!b.today.some((x) => x.text.includes("prix")), "les prix sont pour les gérants");
  assert.ok(!b.today.some((x) => x.text.includes("€")), "pas d'argent pour l'équipe");
  assert.deepEqual(b.today.map((x) => n(x.text)), ["déjà 1 vente", "4 ventes par jour pour tenir l'objectif du mois"]);
});

test("Ma journée : une boutique toute neuve n'a pas de « moyenne » faite de zéros", () => {
  const d = days([...Array(27).fill([0, 0]), [1, 3000], [2, 6000], [0, 0]] as [number, number][]);
  const b = dayBrief({ progress: progress(d), ship: 0, publish: 0, prices: 0, manager: true });
  assert.deepEqual(b.yesterday.map((x) => n([x.text, x.note].filter(Boolean).join(" "))), ["2 ventes, 60 €"], "un seul jour d'historique : pas de comparaison");
  assert.deepEqual(b.today, []);
});

test("Ma journée : un jour sans vente n'est pas « 100 % en dessous »", () => {
  const d = days([...Array(28).fill([2, 10000]), [0, 0], [0, 0]] as [number, number][]);
  const b = dayBrief({ progress: progress(d), ship: 0, publish: 0, prices: 0, manager: true });
  assert.deepEqual(b.yesterday.map((x) => n([x.text, x.note].filter(Boolean).join(" "))), ["aucune vente", "d'habitude 100 € par jour"]);
  assert.equal(b.yesterday[1].tone, "same");
});

test("Ma journée : objectif atteint", () => {
  const d = days([...Array(29).fill([2, 10000]), [0, 0]] as [number, number][]);
  const p = progress(d, [{ period: "month", metric: "revenue", target: 100000 }], { sales: 58, revenue_cents: 290000, listed: 0 });
  const b = dayBrief({ progress: p, ship: 0, publish: 0, prices: 0, manager: true });
  assert.equal(n(`${b.yesterday[1].text} ${b.yesterday[1].note}`), "dans votre moyenne (100 € par jour)");
  assert.deepEqual(b.today.map((x) => [n(x.text), x.tone]), [["objectif du mois atteint (chiffre d'affaires)", "good"]]);
});

console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
