// Unit tests of the lot rotation (src/lib/lot-rotation.ts): the three KPI, the statuses, the pace and the estimates.
// Run: npm run test:lots
import assert from "node:assert/strict";
import { days, rotation, type LotRow } from "../src/lib/lot-rotation";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};
const at = (d: string) => new Date(`${d}T10:00:00+01:00`).getTime();
const iso = (d: string) => new Date(at(d)).toISOString();
const lot = (p: Partial<LotRow> = {}): LotRow => ({
  batch_id: "b", code: "LOT-BLAZERS", purchased_at: "2026-10-25", listing_started_at: null, total: 300, rejected: 0, listed: 0, sold: 0,
  first_listed_at: null, last_listed_at: null, first_sold_at: null, last_sold_at: null, avg_days_to_sell: null, timed: 0, ...p,
});

test("le cas du cahier des charges : 300 blazers, 1 nov. → 30 nov. → 30 déc.", () => {
  const r = rotation(lot({ listing_started_at: iso("2026-11-01"), listed: 300, sold: 300, first_listed_at: iso("2026-11-01"),
    last_listed_at: iso("2026-11-30"), first_sold_at: iso("2026-11-11"), last_sold_at: iso("2026-12-30"), avg_days_to_sell: "20.00", timed: 300 }),
    at("2027-01-15"));
  assert.equal(r.status, "liquide");
  assert.equal(Math.round(r.listing.days!), 29);           // 1 → 30 novembre
  assert.ok(r.listing.done);
  assert.equal(r.avgDaysToSell, 20);
  assert.equal(Math.round(r.liquidation.days!), 59);       // depuis le PREMIER listing
  assert.ok(r.liquidation.done);
  assert.equal(r.projection, null, "plus d'estimation une fois liquidé");
  assert.equal(r.timeline.find((x) => x.key === "liquide")!.at, iso("2026-12-30"));
});

test("liquidation figée : relue plus tard, toujours 59 jours", () => {
  const row = lot({ listing_started_at: iso("2026-11-01"), listed: 300, sold: 300, last_listed_at: iso("2026-11-30"),
    last_sold_at: iso("2026-12-30"), avg_days_to_sell: 20, timed: 300 });
  assert.equal(Math.round(rotation(row, at("2027-03-01")).liquidation.days!), 59);
  assert.equal(Math.round(rotation(row, at("2028-01-01")).liquidation.days!), 59);
});

test("aucun article en ligne : stock reçu, tout à « — »", () => {
  const r = rotation(lot(), at("2026-11-01"));
  assert.equal(r.status, "recu");
  assert.equal(r.listing.days, null); assert.equal(r.avgDaysToSell, null); assert.equal(r.liquidation.days, null);
  assert.equal(r.startMissing, false);
  assert.equal(r.pctListed, 0);
  assert.equal(days(null), "—");
});

test("bouton cliqué, rien encore publié : mise en ligne commencée", () => {
  const r = rotation(lot({ listing_started_at: iso("2026-11-01") }), at("2026-11-01") + 3600_000);
  assert.equal(r.status, "mise_en_ligne");
  assert.equal(r.listing.rate, null, "pas de rythme avant une journée");
});

test("150 articles en 15 jours : 10 / jour, 15 jours restants", () => {
  const r = rotation(lot({ listing_started_at: iso("2026-11-01"), listed: 150, first_listed_at: iso("2026-11-01"), last_listed_at: iso("2026-11-15") }),
    at("2026-11-16"));
  assert.equal(r.status, "mise_en_ligne");
  assert.equal(r.listing.rate, 10);
  assert.equal(r.listing.daysLeft, 15);
  assert.equal(r.listing.endAt, iso("2026-12-01"));
  assert.equal(Math.round(r.pctListed), 50);
  assert.equal(r.listing.done, false);
  assert.equal(r.liquidation.done, false);
  assert.equal(Math.round(r.liquidation.elapsed!), 15, "en cours depuis le premier listing");
  assert.equal(r.avgDaysToSell, null, "en attente de ventes");
});

test("tout en ligne, aucune vente : 100 % en ligne ; avec des ventes : liquidation", () => {
  const base = { listing_started_at: iso("2026-11-01"), listed: 300, last_listed_at: iso("2026-11-30") };
  assert.equal(rotation(lot(base), at("2026-12-01")).status, "en_ligne");
  const r = rotation(lot({ ...base, sold: 240, avg_days_to_sell: 19.666, timed: 240, last_sold_at: iso("2026-12-20") }), at("2026-12-21"));
  assert.equal(r.status, "liquidation");
  assert.equal(r.remaining, 60);
  assert.equal(Math.round(r.pctSold), 80);
  assert.equal(days(r.avgDaysToSell, 1), "19,7 jours");
  assert.equal(r.liquidation.days, null);
});

test("projection de liquidation : 200 vendus en 30 jours sur 300 → ≈ 45 jours (estimation)", () => {
  const r = rotation(lot({ listing_started_at: iso("2026-11-01"), listed: 300, sold: 200, last_listed_at: iso("2026-11-30"), timed: 200, avg_days_to_sell: 15 }),
    at("2026-12-01"));
  assert.equal(Math.round(r.projection!.days), 45);
  assert.equal(r.projection!.at, iso("2026-12-16"));
});

test("projection seulement avec assez de données", () => {
  const few = rotation(lot({ listing_started_at: iso("2026-11-01"), listed: 50, sold: 4 }), at("2026-11-20"));
  assert.equal(few.projection, null, "4 ventes : pas d'estimation");
  const early = rotation(lot({ listing_started_at: iso("2026-11-01"), listed: 50, sold: 20 }), at("2026-11-05"));
  assert.equal(early.projection, null, "moins d'une semaine : pas d'estimation");
});

test("articles déjà en ligne sans date de début : alerte, date jamais inventée", () => {
  const r = rotation(lot({ listed: 40, first_listed_at: iso("2026-09-10") }), at("2026-11-01"));
  assert.equal(r.startMissing, true);
  assert.equal(r.suggestedStart, iso("2026-09-10"), "proposée, pas appliquée");
  assert.equal(r.listing.days, null); assert.equal(r.liquidation.days, null);
  assert.equal(r.status, "mise_en_ligne");
});

test("articles écartés : ils ne sont pas attendus pour finir le lot", () => {
  const r = rotation(lot({ listing_started_at: iso("2026-11-01"), total: 300, rejected: 2, listed: 298, sold: 298,
    last_listed_at: iso("2026-11-30"), last_sold_at: iso("2026-12-30"), avg_days_to_sell: 20, timed: 298 }), at("2027-01-02"));
  assert.equal(r.sellable, 298);
  assert.equal(r.status, "liquide");
  assert.equal(Math.round(r.liquidation.days!), 59);
});

test("date de début posée après les premières publications : pas de durée négative", () => {
  const r = rotation(lot({ listing_started_at: iso("2026-12-01"), listed: 300, last_listed_at: iso("2026-11-30") }), at("2026-12-02"));
  assert.equal(r.listing.days, 0);
});

console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
