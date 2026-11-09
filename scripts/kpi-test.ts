// Unit tests of the Indicateurs page (src/lib/kpi): types, brands, sizes, assumed costs, the tables by type and brand,
// judging a lot, stock by age, pace, sizes, buyers and the data to record.
// Run: npm run test:kpi
import assert from "node:assert/strict";
import { designerOf, familyOf, sizeOf, estimatedCost, costUsed } from "../src/lib/kpi/classify";
import {
  aging, buyers, byDesigner, byFamily, cashCycle, dataQuality, enrich, judgeLot, pace, perHour, sizes, suppliers, unbrandedByFamily,
  type KpiItem, type KpiOrder,
} from "../src/lib/kpi/compute";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};
const NOW = Date.parse("2026-11-09T12:00:00+01:00");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
let seq = 0;
const item = (p: Partial<KpiItem> = {}): KpiItem => ({
  id: `i${++seq}`, sku: `SKU-${seq}`, status: "completed", title: "Blazer Harris Tweed chevrons T 50 (L)", brand: null, category: null,
  sizeLabel: null, listPrice: null, receivedAt: daysAgo(60), listedAt: null, soldAt: daysAgo(10), isSold: true,
  revenue: 4000, profit: 2900, cost: 1000, batchId: "b1", batchCode: "LOT-1", batchKind: "opening_stock", supplier: null, purchasedAt: null, ...p,
});
const d = (title: string, brand: string | null = null, category: string | null = null) => ({ title, brand, category });

test("types : l'ordre des règles (manteau > costume > Harris > croisé > tweed > blazer)", () => {
  assert.equal(familyOf(d("Manteau Long Tweed Chevrons Polo Ralph Lauren")), "manteau");
  assert.equal(familyOf(d("Blazer caban femme noir croisé – Burberry London")), "manteau");
  assert.equal(familyOf(d("Blazer Harris Tweed croisé marron")), "harris");
  assert.equal(familyOf(d("Blazer homme marron tweed vintage Chap’s Ralph Lauren")), "tweed");
  assert.equal(familyOf(d("Blazer croisé bleu marine – Yves Saint Laurent")), "croise");
  assert.equal(familyOf(d("Veste de costume Christian Dior en laine")), "blazer");
  assert.equal(familyOf(d("Costume Croisé Homme Laine Laurent Cerrer")), "costume");
  assert.equal(familyOf(d("Blazer smoking homme noir satiné – Christian Dior")), "blazer");
  assert.equal(familyOf(d("Lot 3 articles blazers")), "lot");
  assert.equal(familyOf(d("Lot de 4 vestes en laine")), "lot");
  assert.equal(familyOf(d("Veste chevrons", "Blazer Tweed")), "tweed");
  assert.equal(familyOf(d("Veste chevrons", "Harris Tweed")), "harris");
  assert.equal(familyOf(d("Pièce vintage", "Manteau vintage femme")), "manteau");
  assert.equal(familyOf(d("Pull 100% Cachemire")), "autre");
  assert.equal(familyOf(d("", null, "Blazer")), "blazer");
});

test("marques : la ligne la plus précise, sans faux amis", () => {
  assert.equal(designerOf(d("Blazer Polo Ralph Lauren en velours")), "Polo Ralph Lauren");
  assert.equal(designerOf(d("Blazer Harris Tweed Double RL Ralph Lauren 90's")), "Double RL");
  assert.equal(designerOf(d("Blazer tweed Chap’s Ralph Lauren")), "Chaps Ralph Lauren");
  assert.equal(designerOf(d("Lauren Ralph Lauren Veste Blazer Tweed")), "Lauren Ralph Lauren");
  assert.equal(designerOf(d("Veste vintage Yves Saint LaurentWoodward & Lothrop")), "Yves Saint Laurent");
  assert.equal(designerOf(d("Blazer vintage Burberrys – Made in England")), "Burberry");
  assert.equal(designerOf(d("Blazer croisé bleu pétrole Laurent Cerrer")), null, "Laurent Cerrer n'est pas YSL");
  assert.equal(designerOf(d("Blazer Christian Dior Vintage")), "Christian Dior");
  assert.equal(designerOf(d("Blazer Giorgio Armani")), "Giorgio Armani");
  assert.equal(designerOf(d("Blazer Armani")), "Armani");
  assert.equal(designerOf(d("Veste en laine, gants en cuir")), null);
  assert.equal(designerOf(d("Blazer", "Loro Piana")), "Loro Piana");
});

test("tailles : champ taille, lettre du titre, puis taille EU", () => {
  assert.equal(sizeOf("Blazer – Taille EU 54 (XL)", null), "XL");
  assert.equal(sizeOf("Blazer – Taille EU 52", null), "L");
  assert.equal(sizeOf("Blazer – Taille EU 62 (5XL)", null), "3XL+");
  assert.equal(sizeOf("Blazer T 46", null), "S");
  assert.equal(sizeOf("Blazer 48 EU", null), "M");
  assert.equal(sizeOf("Blazer chevrons", "M / 38 / 10"), "M");
  assert.equal(sizeOf("Blazer chevrons", "XXXL"), "3XL+");
  assert.equal(sizeOf("Blazer L'élégance anglaise", null), null, "L' n'est pas une taille");
  assert.equal(sizeOf("Blazer homme", "50"), "L");
  assert.equal(sizeOf("Blazer homme", null), null);
});

test("coût inconnu : 10 € Harris, manteau, costume ; 4 € sinon ; 4 € par pièce d'un lot", () => {
  assert.equal(estimatedCost("harris", null), 1000);
  assert.equal(estimatedCost("tweed", null), 400);
  assert.equal(estimatedCost("lot", "Lot 3 articles"), 1200);
  assert.deepEqual(costUsed(100, "harris", null), { cents: 1000, estimated: true });
  assert.deepEqual(costUsed(800, "harris", null), { cents: 800, estimated: false });
  const [e] = enrich([item({ cost: 100, profit: 3800, revenue: 4000 })]);
  assert.equal(e.margin, 3800 + 100 - 1000, "la marge compte 10 € au lieu de 1 €");
  const [k] = enrich([item({ cost: 1200, profit: 2700 })]);
  assert.equal(k.margin, 2700);
  assert.equal(enrich([item({ isSold: false, soldAt: null, status: "listed" })])[0].margin, null);
});

test("par type : prix moyen, médiane, prix d'achat max (¼), marge, coûts supposés", () => {
  const items = enrich([
    item({ revenue: 4000, profit: 3000, cost: 100 }), item({ revenue: 5000, profit: 3900, cost: 1000 }), item({ revenue: 3000, profit: 1900, cost: 1000 }),
    item({ title: "Blazer tweed Donegal", revenue: 2000, profit: 1500, cost: 400 }),
    item({ status: "listed", isSold: false, soldAt: null, listPrice: 4500 }),
  ]);
  const fam = byFamily(items, { now: NOW, periodDays: 365 });
  const h = fam.find((g) => g.key === "harris")!;
  assert.equal(h.sold, 3);
  assert.equal(h.avgPrice, 4000);
  assert.equal(h.medianPrice, 4000);
  assert.equal(h.maxBuy, 1000, "¼ de 40 €");
  assert.equal(h.estimatedCosts, 1);
  assert.equal(h.marginPerPiece, ((3000 + 100 - 1000) + 3900 + 1900) / 3);
  assert.equal(h.inStock, 1);
  assert.equal(h.stockAvgPrice, 4500);
  assert.equal(h.advice.tone, "few");
  assert.equal(fam[0].key, "harris", "trié par chiffre d'affaires");
});

test("par type : la période ne garde que les ventes des 12 derniers mois", () => {
  const items = enrich([item({ soldAt: daysAgo(400) }), item({ soldAt: daysAgo(20) })]);
  assert.equal(byFamily(items, { now: NOW, periodDays: 365 })[0].sold, 1);
  assert.equal(byFamily(items, { now: NOW, periodDays: null })[0].sold, 2);
});

test("conseil : part en moins de 2 jours → monter le prix", () => {
  const rows = Array.from({ length: 6 }, (_, n) => item({ listedAt: daysAgo(11), soldAt: daysAgo(n < 4 ? 10 : 1) }));
  const g = byFamily(enrich(rows), { now: NOW, periodDays: 365 })[0];
  assert.equal(g.timed, 6);
  assert.equal(Math.round(g.fastShare! * 100), 67);
  assert.equal(g.medianDays, 1);
  assert.equal(g.advice.tone, "up");
  assert.match(g.advice.text, /monte le prix/);
});

test("% vendus : sur les lots achetés reçus il y a plus de 30 jours, sinon sur tout (approx)", () => {
  const bought = (sold: boolean, rec = 60) => item({ batchKind: "purchase", receivedAt: daysAgo(rec), isSold: sold, soldAt: sold ? daysAgo(5) : null, status: sold ? "completed" : "listed" });
  const rows = [...Array.from({ length: 3 }, () => bought(true)), ...Array.from({ length: 7 }, () => bought(false)), bought(false, 10)];
  const g = byFamily(enrich(rows), { now: NOW, periodDays: 365 })[0];
  assert.equal(g.sellThrough.base, 10, "le lot reçu il y a 10 jours n'est pas compté");
  assert.equal(g.sellThrough.pct, 30);
  assert.equal(g.sellThrough.approx, false);
  assert.equal(g.advice.tone, "few", "3 ventes : pas encore de conclusion");
  const few = byFamily(enrich([...Array.from({ length: 6 }, () => item())]), { now: NOW, periodDays: 365 })[0];
  assert.equal(few.sellThrough.approx, true);
  assert.equal(few.sellThrough.pct, 100);
});

test("conseil : saison (oct.–mars bien plus cher qu'avr.–sept.)", () => {
  const at = (iso: string, revenue: number) => item({ soldAt: iso, revenue });
  const rows = [
    ...["2025-11-05", "2025-12-05", "2026-01-05", "2026-02-05", "2026-10-20"].map((x) => at(`${x}T12:00:00Z`, 3000)),
    ...["2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05"].map((x) => at(`${x}T12:00:00Z`, 1500)),
  ];
  const g = byFamily(enrich(rows), { now: NOW, periodDays: null })[0];
  assert.equal(g.cold.avg, 3000);
  assert.equal(g.warm.avg, 1500);
  assert.equal(g.advice.tone, "ok");
  assert.match(g.advice.text, /100 % plus cher d'octobre à mars/);
  assert.equal(g.months.length, 12);
  assert.equal(g.months.at(-1)!.month, "2026-11");
  assert.equal(g.months.find((m) => m.month === "2026-10")!.avg, 3000);
});

test("par marque et sans marque", () => {
  const items = enrich([
    item({ title: "Blazer croisé bleu marine – Yves Saint Laurent", revenue: 7000 }),
    item({ title: "Blazer croisé gris", revenue: 2300 }), item({ title: "Blazer croisé noir", revenue: 2200 }),
  ]);
  const brands = byDesigner(items, { now: NOW, periodDays: null });
  assert.deepEqual(brands.map((b) => [b.label, b.sold]), [["Yves Saint Laurent", 1]]);
  const plain = unbrandedByFamily(items, { now: NOW, periodDays: null });
  assert.equal(plain[0].label, "Blazer croisé sans marque");
  assert.equal(plain[0].avgPrice, 2250);
});

test("juger un lot : le lot Barbour (9 pièces à ~39 €, 450 € livré)", () => {
  const j = judgeLot([{ avgPrice: 8500, qty: 1 }, { avgPrice: 3500, qty: 8 }], 45065);
  assert.equal(j.pieces, 9);
  assert.equal(j.revenue, 36500);
  assert.equal(j.verdict, "cher");
  assert.equal(j.maxPrice, 9100, "¼ de 365 € arrondi à l'euro");
  assert.equal(j.profit, 36500 - 45065);
  const ok = judgeLot([{ avgPrice: 4000, qty: 50 }], 50000);
  assert.equal(ok.verdict, "bon");
  assert.equal(judgeLot([{ avgPrice: 4000, qty: 10 }], 14000).verdict, "correct");
  const duty = judgeLot([{ avgPrice: 4000, qty: 10 }], 10000, 20);
  assert.equal(duty.cost, 12000);
  assert.equal(duty.verdict, "correct");
  assert.equal(duty.maxPrice, 8300, "10 000 / 1,2 arrondi");
  assert.equal(judgeLot([], 10000).verdict, "vide");
  assert.equal(judgeLot([{ avgPrice: null, qty: 3 }], 10000).verdict, "vide");
});

test("stock par ancienneté : quatre tranches, depuis la mise en ligne (sinon la réception)", () => {
  const online = (days: number, withDate = true) => item({ status: "listed", isSold: false, soldAt: null, listPrice: 3000, listedAt: withDate ? daysAgo(days) : null, receivedAt: daysAgo(days) });
  const a = aging(enrich([online(5), online(40), online(45, false), online(70), online(120), online(200),
    item({ status: "photographed", isSold: false, soldAt: null, receivedAt: daysAgo(20) }), item({ status: "received", isSold: false, soldAt: null, receivedAt: daysAgo(3) })]), NOW);
  assert.deepEqual(a.online.map((b) => b.count), [1, 2, 1, 2]);
  assert.equal(a.online[3].value, 6000);
  assert.equal(a.online[3].families[0].label, "Blazer Harris Tweed");
  assert.equal(a.undated, 1);
  assert.deepEqual(a.waiting, { count: 2, old: 1, value: 0 });
});

test("rythme : mises en ligne et ventes par semaine, couverture du stock, marge des 90 jours", () => {
  const rows = enrich([
    item({ listedAt: daysAgo(1), soldAt: daysAgo(0.5) }), item({ listedAt: daysAgo(3), soldAt: daysAgo(40), margin: 0 } as Partial<KpiItem>),
    item({ status: "listed", isSold: false, soldAt: null, listedAt: daysAgo(8) }),
    item({ status: "listed", isSold: false, soldAt: null, listedAt: daysAgo(100) }),
    item({ status: "sorted", isSold: false, soldAt: null, listedAt: null }),
    item({ soldAt: daysAgo(200) }),
  ]);
  const p = pace(rows, NOW);
  assert.equal(p.weeks.length, 12);
  assert.equal(p.weeks.at(-1)!.start, "2026-11-09", "lundi de la semaine en cours");
  assert.equal(p.weeks.reduce((s, w) => s + w.listed, 0), 3, "la mise en ligne d'il y a 100 jours est hors des 12 semaines");
  assert.equal(p.listed7, 2);
  assert.equal(p.cover.stock, 3);
  assert.equal(p.cover.online, 2);
  assert.equal(p.cover.perMonth, (2 / 90) * 30);
  assert.equal(Math.round(p.cover.months! * 10) / 10, 4.5);
  assert.equal(p.hour.sold, 2);
  assert.equal(perHour(1500, 20), 4500);
  assert.equal(perHour(null, 20), null);
});

test("cycle de trésorerie et fournisseurs : lots achetés seulement", () => {
  const b = (p: Partial<KpiItem>) => item({ batchKind: "purchase", supplier: "Fripes SARL", batchId: "L1", purchasedAt: "2026-09-01", ...p });
  const rows = enrich([
    b({ soldAt: "2026-09-11T10:00:00Z", cost: 500 }), b({ soldAt: "2026-10-01T10:00:00Z", cost: 500 }), b({ status: "listed", isSold: false, soldAt: null, cost: 500 }),
    item({ soldAt: daysAgo(3) }),
  ]);
  const c = cashCycle(rows, NOW);
  assert.equal(c.n, 2);
  assert.equal(Math.round(c.median!), 20);
  const s = suppliers(rows);
  assert.equal(s.length, 1);
  assert.equal(s[0].pieces, 3);
  assert.equal(Math.round(s[0].pct!), 67);
  assert.equal(s[0].costPerPiece, 500);
  assert.equal(Math.round(s[0].cycle!), 20);
});

test("tailles : ce qui manque et ce qui dort", () => {
  const sold = (size: string, n: number) => Array.from({ length: n }, () => item({ sizeLabel: size }));
  const stock = (size: string, n: number) => Array.from({ length: n }, () => item({ sizeLabel: size, status: "listed", isSold: false, soldAt: null }));
  const rows = sizes(enrich([...sold("M", 20), ...stock("M", 2), ...sold("XL", 5), ...stock("XL", 15), ...sold("L", 10), ...stock("L", 5), item({ title: "Blazer" })]), NOW);
  const m = rows.find((r) => r.size === "M")!, xl = rows.find((r) => r.size === "XL")!, l = rows.find((r) => r.size === "L")!;
  assert.equal(m.verdict, "manque");
  assert.equal(xl.verdict, "trop");
  assert.equal(l.verdict, "ok");
  assert.equal(Math.round(m.soldShare! * 100), 57);
  assert.equal(xl.cover, 15 / (5 / 12));
  assert.equal(rows.at(-1)!.size, null, "les tailles inconnues à part");
  assert.equal(rows.at(-1)!.soldShare, null);
});

test("acheteurs : fidèles, panier moyen, part du CA", () => {
  const o = (buyer: string | null, gross: number, items = 1, ago = 10): KpiOrder => ({ id: `o${++seq}`, soldAt: daysAgo(ago), buyer, gross, items });
  const b = buyers([o("anne", 4000), o("anne", 6000, 2), o("bob", 2000), o(null, 3000), o("carl", 9000, 3, 400)], NOW);
  assert.equal(b.orders, 4);
  assert.equal(b.buyers, 2);
  assert.equal(b.repeat, 1);
  assert.equal(b.repeatRevenueShare, 10000 / 12000);
  assert.equal(b.avgBasket, 3750);
  assert.equal(b.itemsPerOrder, 1.25);
  assert.equal(b.multiShare, 0.25);
  assert.deepEqual(b.top.map((t) => [t.handle, t.orders, t.spent]), [["anne", 2, 10000], ["bob", 1, 2000]]);
});

test("données à compléter : coûts inconnus, dates, dépenses, frais des lots", () => {
  const rows = enrich([item({ cost: 100 }), item({ cost: 900 }), item({ status: "listed", isSold: false, soldAt: null, cost: 0 }),
    item({ status: "listed", isSold: false, soldAt: null, listedAt: daysAgo(3), cost: 500 })]);
  const q = dataQuality(rows, [{ spentOn: "2026-10-01", cents: 1500 }, { spentOn: "2026-01-01", cents: 9000 }], [
    { id: "a", code: "LOT-A", kind: "purchase", purchasedAt: "2026-09-01", lineKinds: ["goods"] },
    { id: "b", code: "LOT-B", kind: "purchase", purchasedAt: "2026-09-01", lineKinds: ["goods", "transport"] },
    { id: "c", code: "VINTED", kind: "opening_stock", purchasedAt: "2026-01-01", lineKinds: [] },
    { id: "d", code: "LOT-OLD", kind: "purchase", purchasedAt: "2025-01-01", lineKinds: ["goods"] },
  ], NOW);
  assert.equal(q.soldNoCost, 1);
  assert.equal(q.soldTotal, 2);
  assert.equal(q.stockNoCost, 1);
  assert.equal(q.onlineNoDate, 1);
  assert.deepEqual(q.expenses90, { n: 1, cents: 1500 });
  assert.deepEqual(q.lotsNoFees.map((l) => l.code), ["LOT-A"]);
});

console.log(`\n${passed} tests passés`);
