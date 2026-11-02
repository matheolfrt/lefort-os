// Full backup ZIP: contents, CSV copy, summary, reminder. Run: npm run test:backup
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { BACKUP_TABLES, buildBackup, daysSince, tableCsv } from "../src/lib/backup";
import { dayBrief } from "../src/lib/day-brief";

const at = new Date("2026-11-02T10:00:00Z");
const { zip, info } = buildBackup({
  items: { rows: [{ id: "a", sku: "LSH-1", title: "Blazer; tweed", tags: ["x"] }, { id: "b", sku: "LSH-2", extra: null }] },
  notes: { rows: [] },
  market_items: { rows: [], error: "relation does not exist" },
}, "Lefort Second Hand", at);
const files = unzipSync(zip);
assert.deepEqual(Object.keys(files).sort(), ["LISEZMOI.txt", "csv/items.csv", "csv/notes.csv", "json/items.json", "json/notes.json", "sauvegarde.json"]);
assert.deepEqual(JSON.parse(strFromU8(files["json/items.json"]))[0], { id: "a", sku: "LSH-1", title: "Blazer; tweed", tags: ["x"] });
assert.equal(info.total, 2);
assert.deepEqual(info.errors, { market_items: "relation does not exist" });
assert.match(strFromU8(files["LISEZMOI.txt"]), /market_items : relation does not exist/);
console.log("ok  ZIP : JSON exact, CSV, résumé, tables non lues signalées");

const csv = tableCsv([{ id: "a", title: "Blazer; tweed", tags: ["x"] }, { id: "b", extra: 1 }]);
assert.equal(csv, '﻿id;title;tags;extra\r\na;"Blazer; tweed";"[""x""]";\r\nb;;;1');
console.log("ok  CSV : toutes les colonnes, point-virgule protégé, objets en JSON");

assert.equal(daysSince(null, at), null);
assert.equal(daysSince("2026-10-25T10:00:00Z", at), 8);
assert.equal(daysSince("pas une date", at), null);
const brief = (backupDays: number | null) => dayBrief({ progress: null, ship: 0, publish: 0, prices: 0, manager: true, backupDays }).today.map((p) => p.text);
assert.deepEqual(brief(8), ["une sauvegarde à faire (la dernière date de 8 jours)"]);
assert.deepEqual(brief(3), []);
assert.deepEqual(brief(null), [], "jamais sauvegardé depuis cet appareil (ex. le téléphone) : pas de rappel");
assert.deepEqual(dayBrief({ progress: null, ship: 0, publish: 0, prices: 0, manager: false, backupDays: 30 }).today, [], "pas pour un opérateur");
console.log("ok  rappel dans « Ma journée » après 7 jours, responsables seulement");

assert.ok(Object.values(BACKUP_TABLES).every((cols) => cols.length > 0));
assert.ok(!("market_keys" in BACKUP_TABLES), "les clés des collecteurs ne sortent pas");
console.log("ok  chaque table a un ordre stable\n\n4 tests réussis");
