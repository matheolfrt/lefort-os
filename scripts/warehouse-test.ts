// Unit tests of the warehouse planner (src/lib/warehouse.ts). Run: npm run test:warehouse
import assert from "node:assert/strict";
import { AISLE, DEFAULT_ROOM, SHELF, clampToRoom, collisions, fits, freeSpot, narrowAisles, readPlan, rect, row, stats, type Shelf } from "../src/lib/warehouse";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const shelf = (x: number, z: number, rot: 0 | 90 = 0, id = `${x},${z},${rot}`): Shelf => ({ id, x, z, rot, ...SHELF });

test("le local par défaut fait 200 m²", () => {
  close(DEFAULT_ROOM.w * DEFAULT_ROOM.d, 200);
  assert.ok(AISLE >= 0.9);
  assert.ok(DEFAULT_ROOM.h >= SHELF.h);
});

test("une étagère 60 × 120 occupe 120 × 60, ou 60 × 120 tournée", () => {
  const r = rect(shelf(5, 5)); close(r.x1 - r.x0, 1.2); close(r.z1 - r.z0, 0.6);
  const t = rect(shelf(5, 5, 90)); close(t.x1 - t.x0, 0.6); close(t.z1 - t.z0, 1.2);
});

test("dos à dos ou côte à côte : permis ; l'une dans l'autre : refusé", () => {
  const a = shelf(1, 1);
  assert.equal(collisions(shelf(1, 1.6), [a]).length, 0, "dos à dos");
  assert.equal(collisions(shelf(2.2, 1), [a]).length, 0, "côte à côte");
  assert.equal(collisions(shelf(1.5, 1.2), [a]).length, 1, "chevauche");
});

test("dans le local : pas à travers un mur, ni plus haute que le plafond", () => {
  assert.ok(fits(DEFAULT_ROOM, shelf(0.6, 0.3), []));
  assert.ok(!fits(DEFAULT_ROOM, shelf(0.5, 0.3), []), "dépasse du mur");
  assert.ok(!fits({ w: 20, d: 10, h: 1.8 }, shelf(5, 5), []), "trop haute");
  const c = clampToRoom(DEFAULT_ROOM, shelf(-3, 50));
  close(c.x, 0.6); close(c.z, 9.7);
});

test("ajouter : la première place libre, sans chevaucher", () => {
  const a = freeSpot(DEFAULT_ROOM, [])!;
  close(a.x, 0.6); close(a.z, 0.3);
  const b = freeSpot(DEFAULT_ROOM, [a])!;
  assert.equal(collisions(b, [a]).length, 0);
  assert.ok(fits(DEFAULT_ROOM, b, [a]));
});

test("une rangée de 5, et une double rangée dos à dos", () => {
  const r = row(DEFAULT_ROOM, [], 5);
  assert.equal(r.length, 5);
  close(r[4].x - r[0].x, 4 * 1.2);
  assert.equal(narrowAisles(r).length, 0, "côte à côte, pas une allée");
  const d = row(DEFAULT_ROOM, r, 4, true);
  assert.equal(d.length, 8);
  assert.ok(d.every((s) => fits(DEFAULT_ROOM, s, [...r, ...d.filter((o) => o.id !== s.id)])));
});

test("les rangées ajoutées laissent une allée d'1 m entre elles", () => {
  // 12 × 1,2 m = 14,4 m: two cannot stand end to end in 20 m, the second goes behind the first
  const a = row(DEFAULT_ROOM, [], 12, true);
  const b = row(DEFAULT_ROOM, a, 12, true);
  const c = row(DEFAULT_ROOM, [...a, ...b], 12);
  assert.equal(c.length, 12);
  const all = [...a, ...b, ...c];
  assert.equal(narrowAisles(all).length, 0, "aucune allée étroite");
  const gap = Math.min(...b.map((s) => rect(s).z0)) - Math.max(...a.map((s) => rect(s).z1));
  close(gap, 1);
  // a shelf added alone goes next to the others, on the same row, rather than in the aisle
  const s = freeSpot(DEFAULT_ROOM, all)!;
  assert.equal(narrowAisles([...all, s]).length, 0);
});

test("allée trop étroite : signalée sous 90 cm, pas au-dessus", () => {
  const a = shelf(5, 1);
  const tight = shelf(5, 1 + 0.6 + 0.7); // 70 cm between the two
  const ok = shelf(5, 1 + 0.6 + 1.0);    // 1 m
  assert.deepEqual(narrowAisles([a, tight]).map((x) => Math.round(x.width * 100)), [70]);
  assert.equal(narrowAisles([a, ok]).length, 0);
  assert.equal(narrowAisles([a, shelf(9, 1.7)]).length, 0, "pas en face l'une de l'autre");
});

test("ce que le plan contient", () => {
  const s = stats(DEFAULT_ROOM, row(DEFAULT_ROOM, [], 10));
  assert.equal(s.shelves, 10);
  assert.equal(s.levels, 50);
  close(s.shelfMetres, 10 * 1.2 * 5);   // 60 m of shelving
  close(s.floorUsed, 10 * 0.72);
  close(s.floorPct, 3.6);
});

test("un plan enregistré abîmé ne casse rien", () => {
  const p = readPlan({ room: { w: "x", d: 12, h: 3 }, shelves: [{ x: 1, z: 2, rot: 90 }, { nope: true }, null] });
  assert.equal(p.room.w, DEFAULT_ROOM.w);
  assert.equal(p.room.d, 12);
  assert.equal(p.shelves.length, 1);
  assert.equal(p.shelves[0].rot, 90);
  assert.equal(p.shelves[0].levels, 5);
  assert.deepEqual(readPlan(null).shelves, []);
});

console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
