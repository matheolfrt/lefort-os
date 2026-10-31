// Unit tests of « Annonces » (src/lib/drafts/text.ts): measurements split by SKU, the model filled. Run: npm run test:drafts
import assert from "node:assert/strict";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, descriptionFields, fieldsOf, fillTemplate, fillTitle, splitMeasures, type DraftContext } from "../src/lib/drafts/text";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok  ${name}`); };

test("mesures collées : un bloc par SKU", () => {
  const text = `Mesures du 30/10

LSH-0012
Épaules : 45 cm
Longueur : 72 cm

lsh-0013 : Poitrine 52 cm
Longueur 70 cm
LSH-0099
Taille 80`;
  const r = splitMeasures(text, ["LSH-0012", "LSH-0013"]);
  assert.equal(r.blocks.get("LSH-0012"), "Épaules : 45 cm\nLongueur : 72 cm");
  assert.equal(r.blocks.get("LSH-0013"), "Poitrine 52 cm\nLongueur 70 cm\nLSH-0099\nTaille 80", "un SKU inconnu reste dans le bloc précédent");
  assert.deepEqual(r.orphan, ["Mesures du 30/10"]);
});

test("SKU entouré de ponctuation, ou répété", () => {
  const r = splitMeasures("[A-1]\népaules 40\n(A-2) longueur 60\nA-1 —  manches 62", ["A-1", "A-2"]);
  assert.equal(r.blocks.get("A-1"), "épaules 40\nmanches 62");
  assert.equal(r.blocks.get("A-2"), "longueur 60");
  assert.equal(splitMeasures("A-10 épaules", ["A-1"]).blocks.size, 0, "A-10 n'est pas A-1");
});

test("modèle : les lignes inconnues disparaissent", () => {
  const out = fillTemplate("Blazer {marque}\nTaille : {taille}\nDéfauts : {defauts}\n\n\n{mesures}\nRéf. {sku}", { marque: "Boss", taille: "50", sku: "A-1", mesures: "Épaules 45" });
  assert.equal(out, "Blazer Boss\nTaille : 50\n\nÉpaules 45\nRéf. A-1");
  assert.equal(fillTemplate("Texte fixe\n{rien}", {}), "Texte fixe", "un texte sans mot reste");
});

test("titre sur une ligne, sans trous", () => {
  assert.equal(fillTitle(DEFAULT_TITLE, { categorie: "Blazer", couleur: "bleu", taille: "T50" }), "Blazer bleu T50");
  assert.equal(fillTitle("{marque} - {categorie}", { categorie: "Veste" }), "Veste");
});

test("données du stock → mots du modèle", () => {
  const ctx: DraftContext = { sku: "A-1", item: { categorie: "Blazer", marque: "Hugo Boss", taille: "50", taille_pantalon: null, etat: "very_good", couleur: "Bleu marine",
    motif: null, matiere: "Laine", defauts: null, prix_cents: 4500, mesures: [{ label: "Épaules", mm: 455 }] } };
  const f = fieldsOf(ctx, "", null);
  assert.equal(fillTitle(DEFAULT_TITLE, f), "Blazer Hugo Boss bleu marine T50");
  const d = fillTemplate(DEFAULT_DESCRIPTION, descriptionFields(f));
  assert.match(d, /^Blazer Hugo Boss\n\nTaille : 50\nÉtat : Très bon état\nCouleur : bleu marine\nMatière : laine\n\nMesures à plat :\n• Épaules : 45,5 cm\n\nRéf\. A-1$/);
  assert.equal(fieldsOf(ctx, "Épaules 46 cm", null).mesures, "Épaules 46 cm", "les mesures collées priment");
  assert.equal(fieldsOf(ctx, "", 3000).prix, "30 €");
  assert.equal(fieldsOf({ sku: "Z-9", item: null }, "", null).marque, undefined, "pas dans le stock : rien d'inventé");
});

console.log(`\n${passed} tests réussis`);
