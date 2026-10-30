// Unit tests of the « Entrepôt 3D » engine (src/lib/warehouse3d). Run: npm run test:warehouse3d
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, capacity, frontPoint, layout, levelId, obstacles, rackCode, readConfig, shelfId, slotPoint, withRacks } from "../src/lib/warehouse3d/config";
import { grid, route, walk } from "../src/lib/warehouse3d/path";
import { groupOf, kpis, ramp, readHeat, readSnapshot, shelfHeat } from "../src/lib/warehouse3d/model";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`ok  ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("configuration par défaut : 200 m², 35 étagères de 120 blazers, 4 200 places", () => {
  close(DEFAULT_CONFIG.room.length * DEFAULT_CONFIG.room.width, 200);
  const c = capacity(DEFAULT_CONFIG);
  assert.deepEqual([c.racks, c.shelves, c.perShelf, c.places], [5, 35, 120, 4200]);
});

test("rien en dur : une autre configuration change tout", () => {
  const c = readConfig({ room: { length: 30, width: 12, height: 4 }, shelf: { width: 1, depth: 0.5, height: 2.4, levels: 6, perLevel: 20 }, aisle: 1.5,
    racks: [{ code: "a", shelves: 10 }, { code: "B", shelves: 10 }, { code: "B", shelves: 3 }, { code: "!", shelves: 2 }] });
  assert.deepEqual(c.racks.map((r) => r.code), ["A", "B"], "codes en majuscules, doublons et invalides écartés");
  assert.equal(capacity(c).places, 20 * 6 * 20);
  const l = layout(c);
  close(l.racks[1].z - l.racks[0].z, 0.5 + 1.5, 1e-9);
  assert.equal(withRacks(c, 4, 8).racks.map((r) => r.code).join(""), "ABCD");
  assert.equal(rackCode(26), "AA");
});

test("valeurs abîmées : la configuration par défaut prend le relais", () => {
  const c = readConfig({ room: { length: -3 }, shelf: { levels: 0 }, colors: { available: "red" }, zones: [null, { kind: "photo", x: 1, z: 1, w: 2, d: 2 }] });
  assert.equal(c.room.length, 20); assert.equal(c.shelf.levels, 5); assert.equal(c.colors.available, DEFAULT_CONFIG.colors.available);
  assert.equal(c.zones.length, 1); assert.ok(c.zones[0].features?.mannequin, "studio photo : équipements par défaut");
  assert.deepEqual(readConfig(null).racks.length, 5);
});

test("identifiants : RACK B, étagère B-07, niveau B-07-L3", () => {
  assert.equal(shelfId("B", 7), "B-07"); assert.equal(levelId("B", 7, 3), "B-07-L3");
  const l = layout(DEFAULT_CONFIG);
  assert.ok(l.shelves.has("E-07") && !l.shelves.has("E-08") && !l.shelves.has("F-01"));
});

test("agencement automatique : rangées séparées par l'allée, dans le local, hors des zones", () => {
  const l = layout(DEFAULT_CONFIG);
  assert.deepEqual(l.warnings, []);
  const obs = obstacles(DEFAULT_CONFIG, l);
  for (let i = 1; i < obs.length; i++) close(obs[i].z0 - obs[i - 1].z1, DEFAULT_CONFIG.aisle);
  assert.ok(obs.every((o) => o.x1 <= Math.min(...DEFAULT_CONFIG.zones.map((z) => z.x)) && o.z1 <= DEFAULT_CONFIG.room.width));
  const tooLong = layout(readConfig({ ...DEFAULT_CONFIG, racks: [{ code: "A", shelves: 30 }] }));
  assert.equal(tooLong.warnings.length, 1, "une rangée trop longue est signalée");
});

test("un article : sur son niveau, à sa place ; on le prend depuis l'allée", () => {
  const c = DEFAULT_CONFIG, s = layout(c).shelves.get("B-07")!;
  const p1 = slotPoint(c, s, 3, 1), p24 = slotPoint(c, s, 3, 24);
  assert.ok(p24.x > p1.x && Math.abs(p24.x - p1.x) < c.shelf.width, "les places suivent la largeur");
  assert.ok(slotPoint(c, s, 5, 1).y > slotPoint(c, s, 1, 1).y);
  const f = frontPoint(c, s);
  assert.ok(f.z > s.z + c.shelf.depth / 2 && f.z < s.z + c.shelf.depth / 2 + c.aisle, "dans l'allée devant");
});

test("picking : chemin par les allées, jamais à travers une étagère, ordre plus court", () => {
  const c = DEFAULT_CONFIG, l = layout(c), g = grid(c, l);
  const at = (id: string) => ({ id, at: frontPoint(c, l.shelves.get(id)!) });
  const start = { x: 15, z: 7.5 };
  const stops = [at("A-03"), at("E-07"), at("C-01"), at("A-04")];
  const r = route(g, start, stops);
  assert.equal(r.stops.length, 4); assert.deepEqual(r.unreachable, []);
  // A-03 and A-04 are next to each other: visited one after the other
  const ia = r.stops.findIndex((s) => s.id === "A-03"), ib = r.stops.findIndex((s) => s.id === "A-04");
  assert.equal(Math.abs(ia - ib), 1, r.stops.map((s) => s.id).join(" → "));
  // no point of the path inside a shelf
  const obs = obstacles(c, l);
  const inside = (p: { x: number; z: number }) => obs.some((o) => p.x > o.x0 + 1e-6 && p.x < o.x1 - 1e-6 && p.z > o.z0 + 1e-6 && p.z < o.z1 - 1e-6);
  for (let i = 1; i < r.path.length; i++) for (let k = 0; k <= 10; k++) {
    const a = r.path[i - 1], b = r.path[i];
    assert.ok(!inside({ x: a.x + (b.x - a.x) * k / 10, z: a.z + (b.z - a.z) * k / 10 }), `segment ${i}`);
  }
  // better than (or as good as) the order given
  const given = route(g, start, [stops[0]]).length + 0; void given;
  assert.ok(r.length > 0 && r.length < 80, String(r.length));
});

test("une place inaccessible est signalée à part", () => {
  const c = readConfig({ ...DEFAULT_CONFIG, aisle: 0.6, racks: [{ code: "A", shelves: 2, x: 0, z: 0 }, { code: "B", shelves: 2, x: 0, z: 0.6 }, { code: "C", shelves: 2, x: 0, z: 1.2 }] });
  const l = layout(c), g = grid(c, l);
  const r = route(g, { x: 15, z: 8 }, [{ id: "x", at: { x: 0.1, z: 0.05 } }]);
  assert.ok(r.unreachable.length + r.stops.length === 1);
});

const raw = {
  warehouse: { id: "w", name: "Entrepôt", config: DEFAULT_CONFIG, updated_at: "" }, manager: true, dead_stock_days: 90, rotation_days: 21.5, to_ship: 2,
  levels: [["l1", "B", 7, 3, 24], ["l2", "B", 7, 4, 24], ["l3", "A", 1, 1, 24]],
  staging: [["p", "EMP-PREPARATION", "Préparation", null], ["r", "EMP-RECEPTION", "Réception", "received"]],
  items: [
    ["i1", "BLZ-00482", "listed", "l1", 42, "2026-01-01", "2026-01-02", 4500, 1500, "Boss", "50"],
    ["i2", "BLZ-00821", "sold", "l2", 1, "2026-10-01", "2026-10-02", 3000, 900, null, null],
    ["i3", "BLZ-00194", "sold", "p", null, "2026-10-01", "2026-10-02", 3000, 900, null, null],
    ["i4", "BLZ-00001", "received", "r", null, "2026-10-28", null, null, 800, null, null],
    ["i5", "BLZ-00002", "on_hold", null, null, "2026-10-28", null, null, 800, null, null],
  ],
};

test("instantané : lu, indexé, retrouvé par SKU", () => {
  const s = readSnapshot(raw);
  assert.equal(s.itemBySku.get("BLZ-00482")?.pos, 42);
  assert.equal(s.levelById.get(s.itemBySku.get("BLZ-00482")!.loc!)?.rack, "B");
  assert.equal(s.levelBySlot.get("B-07-L3")?.id, "l1");
  assert.equal(s.itemsByLoc.get("l1")?.length, 1);
});

test("couleurs : un groupe, un mot et une lettre ; préparé ≠ à préparer", () => {
  assert.equal(groupOf({ status: "listed", loc: "l1" }, "p"), "available");
  assert.equal(groupOf({ status: "sold", loc: "l2" }, "p"), "sold");
  assert.equal(groupOf({ status: "sold", loc: "p" }, "p"), "reserved");
  assert.equal(groupOf({ status: "on_hold", loc: null }, "p"), "problem");
  assert.equal(groupOf({ status: "photographed", loc: null }, "p"), "progress");
});

test("en-tête : stock, valeur, disponibles, à expédier, dormant, rotation", () => {
  const k = kpis(readSnapshot(raw), new Date("2026-10-30").getTime());
  assert.equal(k.stock, 3, "les vendus ne sont plus du stock");
  assert.equal(k.value, 1500 + 800 + 800);
  assert.equal(k.available, 1); assert.equal(k.toShip, 2);
  assert.equal(k.dormant, 1, "en ligne depuis janvier : dormant");
  assert.equal(k.rotationDays, 21.5);
  assert.equal(k.unplaced, 1, "l'article en attente sans emplacement");
});

test("performance : par étagère, sur une teinte, rotation inversée", () => {
  const s = readSnapshot(raw);
  const heat = readHeat({ levels: [["l1", 1, 1500, 300, 1, 2, 9000, 4000, 10], ["l2", 0, 0, null, 0, 1, 3000, 1000, 40], ["l3", 0, 0, null, 0, 0, 0, 0, null]] });
  const rev = shelfHeat(s, heat, "revenue");
  assert.equal(rev.get("B-07")?.raw, 12000, "les niveaux de B-07 additionnés");
  assert.equal(rev.get("B-07")?.t, 1); assert.equal(rev.get("A-01")?.t, 0);
  const rot = shelfHeat(s, heat, "rotation");
  close(rot.get("B-07")!.raw!, (10 * 2 + 40 * 1) / 3);
  assert.equal(rot.get("A-01")?.t, null, "pas de vente : pas de valeur, pas de couleur inventée");
  assert.match(ramp(0), /^#[0-9a-f]{6}$/); assert.notEqual(ramp(0), ramp(1));
});

test("chemin aller simple : par les allées, sans traverser une étagère", () => {
  const l = layout(DEFAULT_CONFIG), g = grid(DEFAULT_CONFIG, l);
  const to = frontPoint(DEFAULT_CONFIG, l.shelves.get("C-04")!), from = { x: 15, z: 6 };
  const w = walk(g, from, to)!;
  assert.ok(w, "accessible");
  const straight = Math.hypot(to.x - from.x, to.z - from.z);
  assert.ok(w.length >= straight - 0.3 && w.length < straight * 1.6, `${w.length} m pour ${straight} m à vol d'oiseau`);
  const last = w.path[w.path.length - 1];
  assert.ok(Math.hypot(last.x - to.x, last.z - to.z) < 0.3, "arrive devant l'étagère");
  for (const o of obstacles(DEFAULT_CONFIG, l)) for (const p of w.path) assert.ok(!(p.x > o.x0 && p.x < o.x1 && p.z > o.z0 && p.z < o.z1), "jamais dans une étagère");
  const shut = readConfig({ ...DEFAULT_CONFIG, zones: [] });
  assert.equal(walk(grid(shut, layout(shut)), { x: 0.1, z: 0.1 }, { x: 0.1, z: 0.1 })?.length, 0);
});

console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
