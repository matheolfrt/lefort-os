// The Stock search words: « -mot » excludes, quotes group words. Run: npm run test:search
import assert from "node:assert/strict";
import { parseSearch } from "../src/lib/stock-search";

assert.deepEqual(parseSearch("blazer tweed -harris"), { include: ["blazer", "tweed"], exclude: ["harris"] });
assert.deepEqual(parseSearch('tweed -"harris tweed"'), { include: ["tweed"], exclude: ["harris tweed"] });
assert.deepEqual(parseSearch('"blazer croisé" 50'), { include: ["blazer croisé", "50"], exclude: [] });
assert.deepEqual(parseSearch("LSH-0012"), { include: ["LSH-0012"], exclude: [] }, "un tiret au milieu n'exclut rien");
assert.deepEqual(parseSearch("- -  tweed"), { include: ["tweed"], exclude: [] }, "un tiret seul est ignoré");
assert.deepEqual(parseSearch("a%b,(c)"), { include: ["a b c"], exclude: [] }, "caractères spéciaux neutralisés");
assert.deepEqual(parseSearch(""), { include: [], exclude: [] });
console.log("ok  recherche : mots, -mot, guillemets\n\n1 test réussi");
