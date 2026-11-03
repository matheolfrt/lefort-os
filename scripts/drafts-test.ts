// Unit tests of « Annonces » (src/lib/drafts/text.ts): measurements split by SKU, the model filled. Run: npm run test:drafts
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { findDefinition, matchMeasures, parseMeasureLines } from "../src/lib/drafts/to-stock";
import { readAnyText, readMeasuresFile, readTable, skuMatcher } from "../src/lib/drafts/measures-file";
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

const isSku = skuMatcher(["A-1", "A-2"], "LSH");

test("fichier : reconnaître un SKU", () => {
  for (const s of ["LSH00012", "lsh-0012", "A-1", "AB12", "VT-2024"]) assert.ok(isSku(s), s);
  for (const s of ["Épaules", "45", "cm", "T50", "2024", "M"]) assert.ok(!isSku(s), s);
});

test("fichier texte : blocs par SKU, SKU encore inconnus compris", () => {
  const r = readAnyText("Mes mesures\nLSH00012\nÉpaules 45\nLSH00013 : Longueur 70\nManches 62", isSku);
  assert.equal(r.format, "texte");
  assert.deepEqual(r.rows, [{ sku: "LSH00012", measures: "Épaules 45" }, { sku: "LSH00013", measures: "Longueur 70\nManches 62" }]);
  assert.equal(r.ignored, 1);
});

test("tableau large : une colonne par mesure", () => {
  const r = readAnyText("SKU;Épaules;Poitrine (cm);Longueur;Remarque\nLSH00012;45;52,5;72;\nLSH00013;44;;70;doublure à recoudre\n;;;;\nTotal;;;;", isSku);
  assert.equal(r.format, "tableau");
  assert.deepEqual(r.rows, [
    { sku: "LSH00012", measures: "Épaules : 45 cm\nPoitrine : 52,5 cm\nLongueur : 72 cm" },
    { sku: "LSH00013", measures: "Épaules : 44 cm\nLongueur : 70 cm\nRemarque : doublure à recoudre" },
  ]);
});

test("tableau long : une ligne par mesure, SKU sous un titre « Référence »", () => {
  const r = readTable([["Référence", "Mesure", "Valeur"], ["X1", "Épaules", "45"], ["X1", "Longueur", "72 cm"], ["x1", "Manches", "60"], ["X2", "Tour de taille", "40"]], isSku);
  assert.deepEqual(r.rows, [{ sku: "X1", measures: "Épaules : 45 cm\nLongueur : 72 cm\nManches : 60 cm" }, { sku: "X2", measures: "Tour de taille : 40 cm" }]);
});

test("tableau sans titres : première colonne = SKU", () => {
  assert.equal(readTable([["SKU", "Taille", "Épaules"], ["LSH1", "50", "45"]], isSku).rows[0].measures, "Taille : 50\nÉpaules : 45 cm", "une taille n'a pas d'unité");
  const r = readTable([["LSH00012", "Épaules 45", "Longueur 72"], ["LSH00013", "Épaules 44"]], isSku);
  assert.deepEqual(r.rows, [{ sku: "LSH00012", measures: "Épaules 45\nLongueur 72" }, { sku: "LSH00013", measures: "Épaules 44" }]);
});

const xml = (s: string) => strToU8(s);
test("Excel (.xlsx) : première feuille, textes partagés, nombres", () => {
  const zip = zipSync({
    "xl/workbook.xml": xml('<workbook><sheets><sheet name="Mesures" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": xml('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": xml("<sst><si><t>SKU</t></si><si><t>Épaules</t></si><si><t>Longueur</t></si><si><t>LSH00012</t></si><si><r><t>LSH</t></r><r><t>00013</t></r></si></sst>"),
    "xl/worksheets/sheet1.xml": xml('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>45.5</v></c><c r="C2"><v>72</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3"><v>70.000000000001</v></c></row></sheetData></worksheet>'),
  });
  const r = readMeasuresFile("mesures.xlsx", zip, isSku);
  assert.equal(r.format, "excel");
  assert.deepEqual(r.rows, [{ sku: "LSH00012", measures: "Épaules : 45,5 cm\nLongueur : 72 cm" }, { sku: "LSH00013", measures: "Longueur : 70 cm" }]);
});

test("Word (.docx) : paragraphes lus comme du texte", () => {
  const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const zip = zipSync({ "word/document.xml": xml(`<w:document><w:body>${p("LSH00012")}${p("Épaules : 45 cm")}${p("LSH00013")}<w:p><w:r><w:t xml:space="preserve">Longueur : </w:t></w:r><w:r><w:t>70 cm</w:t></w:r></w:p></w:body></w:document>`) });
  const r = readMeasuresFile("mesures.docx", zip, isSku);
  assert.deepEqual(r.rows, [{ sku: "LSH00012", measures: "Épaules : 45 cm" }, { sku: "LSH00013", measures: "Longueur : 70 cm" }]);
});

test("formats non lus : message clair", () => {
  assert.throws(() => readMeasuresFile("vieux.xls", new Uint8Array(), isSku), /enregistrez-le en \.xlsx/);
});

const DEFS = [
  { id: "e", key: "shoulders", label: "Épaules", min_mm: 300, max_mm: 700 },
  { id: "l", key: "length", label: "Longueur dos", min_mm: 500, max_mm: 1000 },
  { id: "p", key: "chest", label: "Poitrine", min_mm: 350, max_mm: 800 },
  { id: "m", key: "sleeve", label: "Manches", min_mm: 400, max_mm: 800 },
];
test("vers le stock : lignes de mesures lues", () => {
  assert.deepEqual(parseMeasureLines("• Épaules : 45,5 cm\nLongueur dos 72cm\nPoitrine - 520 mm\nMesures à plat :\nRéf. LSH1\nRéf. CSV-0001\nManches: 62."), [
    { label: "Épaules", mm: 455 }, { label: "Longueur dos", mm: 720 }, { label: "Poitrine", mm: 520 }, { label: "Manches", mm: 620 },
  ]);
});
test("vers le stock : nom de mesure retrouvé", () => {
  assert.equal(findDefinition("epaules", DEFS)?.id, "e");
  assert.equal(findDefinition("Longueur", DEFS)?.id, "l", "« Longueur » est dans « Longueur dos »");
  assert.equal(findDefinition("Tour de taille", DEFS), null);
  const suit = [{ id: "a", key: "j_len", label: "Veste — longueur dos", min_mm: 600, max_mm: 900 }, { id: "b", key: "t_len", label: "Pantalon — longueur extérieure", min_mm: 850, max_mm: 1200 }];
  assert.equal(findDefinition("Longueur", suit), null, "deux longueurs possibles");
  assert.match(matchMeasures("Longueur : 74 cm", suit).skipped[0].reason, /plusieurs mesures possibles : Veste — longueur dos, Pantalon — longueur extérieure/);
  assert.equal(findDefinition("Longueur dos", suit)?.id, "a");
});
test("vers le stock : limites respectées, inconnues signalées", () => {
  const r = matchMeasures("Épaules : 45 cm\nPoitrine : 12 cm\nTour de taille : 40 cm\nÉpaules : 47 cm", DEFS);
  assert.deepEqual(r.saved, [{ definition_id: "e", label: "Épaules", mm: 450 }]);
  assert.deepEqual(r.skipped.map((x) => x.label), ["Poitrine", "Tour de taille"]);
  assert.match(r.skipped[0].reason, /hors limites \(35–80 cm\)/);
});

console.log(`\n${passed} tests réussis`);
