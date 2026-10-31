// A file of measurements for many SKUs, read in the browser: plain text (a SKU line starts a block), a table (CSV,
// TSV, Excel: one row per SKU with a column per measurement, or one row per measurement), or a Word document.
import { unzipSync, strFromU8 } from "fflate";
import { parseCsv } from "@/lib/csv";
import { tidy } from "@/lib/drafts/text";

export interface SkuMeasures { sku: string; measures: string }
export interface ReadResult { rows: SkuMeasures[]; format: "texte" | "tableau" | "excel" | "word"; ignored: number }

/** A SKU: one the shop knows, its own prefix followed by digits, or letters then digits (LSH00012, LSH-0012, AB12) */
export function skuMatcher(known: string[], prefix?: string | null) {
  const set = new Set(known.map((s) => s.toUpperCase()));
  const own = prefix ? new RegExp(`^${prefix.replace(/[^A-Za-z]/g, "")}[-_]?\\d+[A-Z]?$`, "i") : null;
  return (token: string) => {
    const t = token.trim();
    if (!t || t.length > 64 || /\s/.test(t)) return false;
    return set.has(t.toUpperCase()) || Boolean(own?.test(t)) || /^[A-Z]{2,6}[-_]?\d{2,}[A-Z]?$/i.test(t);
  };
}

const SEP = /[\s:;,|()[\]{}«»"'=]+/;

/** Text: a line containing a SKU starts its block; what follows the SKU on that line belongs to it */
export function readText(text: string, isSku: (t: string) => boolean): { rows: SkuMeasures[]; ignored: number } {
  const blocks = new Map<string, string[]>();
  let current: string | null = null, ignored = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const hit = line.split(SEP).filter(Boolean).find(isSku);
    if (hit) {
      current = [...blocks.keys()].find((k) => k.toUpperCase() === hit.toUpperCase()) ?? hit;
      if (!blocks.has(current)) blocks.set(current, []);
      const esc = hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rest = line.replace(new RegExp(`[\\[({«"']*${esc}[\\])}»"']*`), "").replace(/^[\s:;,|\-–—=]+/, "").trim();
      if (rest) blocks.get(current)!.push(rest);
    } else if (current) blocks.get(current)!.push(line);
    else if (line.trim()) ignored++;
  }
  return { rows: [...blocks].map(([sku, l]) => ({ sku, measures: tidy(l.join("\n")) })).filter((r) => r.measures), ignored };
}

const key = (h: string) => h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SKU_HEAD = /^(sku|ref|reference|code|code article|article|id|identifiant|n article|numero)$/;
const NAME_HEAD = /^(mesure|mesures|nom|libelle|intitule|partie|zone|dimension)$/;
const VALUE_HEAD = /^(valeur|valeurs|cm|mesure cm|valeur cm|taille cm|longueur cm)$/;
/** « 45 » or « 45,5 » under « Épaules » → « Épaules : 45 cm » (a unit written in the cell or the header is kept) */
const cell = (head: string, value: string) => {
  const v = value.trim(), h = head.trim().replace(/\s*\((cm|mm)\)\s*$/i, "");
  const unit = /\((mm)\)\s*$/i.test(head) ? "mm" : "cm";
  const noUnit = /^(taille|size|pointure|t|taille us|taille eu|age|âge|quantite|quantité|prix)$/i.test(h.trim());
  return /^\d+([.,]\d+)?$/.test(v) && !noUnit ? `${h} : ${v.replace(".", ",")} ${unit}` : `${h} : ${v}`;
};

/** Table: a SKU column (by its title, else the first column) and either one column per measurement or name + value */
export function readTable(table: string[][], isSku: (t: string) => boolean): { rows: SkuMeasures[]; ignored: number } {
  const rows = table.map((r) => r.map((c) => (c ?? "").toString().trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return { rows: [], ignored: 0 };
  const head = rows[0].map(key);
  let skuCol = head.findIndex((h) => SKU_HEAD.test(h));
  const hasHead = skuCol >= 0 || !isSku(rows[0][0] ?? "");
  if (skuCol < 0) skuCol = 0;
  const body = hasHead ? rows.slice(1) : rows;
  const titled = hasHead && SKU_HEAD.test(head[skuCol] ?? "");
  const nameCol = hasHead ? head.findIndex((h, i) => i !== skuCol && NAME_HEAD.test(h)) : -1;
  const valueCol = hasHead ? head.findIndex((h, i) => i !== skuCol && i !== nameCol && VALUE_HEAD.test(h)) : -1;
  const out = new Map<string, string[]>();
  let ignored = 0;
  for (const r of body) {
    const sku = (r[skuCol] ?? "").trim();
    // under a « SKU » title any code is taken; without a title, only what looks like a SKU
    const ok = titled ? /^\S{1,64}$/.test(sku) : isSku(sku);
    if (!ok) { ignored++; continue; }
    const id = [...out.keys()].find((k) => k.toUpperCase() === sku.toUpperCase()) ?? sku;
    const lines = out.get(id) ?? [];
    if (nameCol >= 0 && valueCol >= 0) {
      if (r[nameCol] && r[valueCol]) lines.push(cell(r[nameCol], r[valueCol]));
    } else {
      r.forEach((v, i) => {
        if (i === skuCol || !v) return;
        lines.push(hasHead && rows[0][i] ? cell(rows[0][i], v) : v);
      });
    }
    out.set(id, lines);
  }
  return { rows: [...out].map(([sku, l]) => ({ sku, measures: l.join("\n") })).filter((r) => r.measures), ignored };
}

// ── Excel (.xlsx) and Word (.docx): zip files of XML ──
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** the first sheet of a workbook, as rows of text */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  // the first sheet in the workbook's order
  const rel = text("xl/workbook.xml").match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rel ? text("xl/_rels/workbook.xml.rels").match(new RegExp(`Id="${rel}"[^>]*Target="([^"]+)"`))?.[1]
    ?? text("xl/_rels/workbook.xml.rels").match(new RegExp(`Target="([^"]+)"[^>]*Id="${rel}"`))?.[1] : null;
  const sheet = text(target ? `xl/${target.replace(/^\/?xl\//, "")}` : "xl/worksheets/sheet1.xml") || text("xl/worksheets/sheet1.xml");
  const out: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      let v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (type === "s") v = shared[Number(v)] ?? "";
      else if (type === "inlineStr") v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
      v = decode(v);
      if (/^-?\d+\.\d{6,}$/.test(v)) v = String(Math.round(Number(v) * 100) / 100); // 45.499999999 → 45.5
      const i = ref ? colIndex(ref) : cells.length;
      while (cells.length < i) cells.push("");
      cells[i] = v;
    }
    out.push(cells);
  }
  return out;
}

/** the text of a Word document, one line per paragraph */
export function readDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const xml = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((p) => decode([...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g)].map((t) => t[1] ?? (t[2] === "tab" ? "\t" : "\n")).join("")))
    .join("\n");
}

/** Any of the accepted files → measurements by SKU */
export function readMeasuresFile(name: string, bytes: Uint8Array, isSku: (t: string) => boolean): ReadResult {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm") return { ...readTable(readXlsx(bytes), isSku), format: "excel" };
  if (ext === "docx") return { ...readText(readDocx(bytes), isSku), format: "word" };
  if (ext === "xls" || ext === "doc" || ext === "pdf" || ext === "numbers" || ext === "pages")
    throw new Error(`Format .${ext} non lu : enregistrez-le en .xlsx, .csv, .docx ou .txt.`);
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  return readAnyText(text, isSku, ext === "csv" || ext === "tsv");
}

/** Text that may be a table (several columns on most lines) or free text */
export function readAnyText(text: string, isSku: (t: string) => boolean, table = false): ReadResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const tabular = table || (lines.length > 1 && lines.filter((l) => /[;\t]/.test(l)).length >= lines.length * 0.8);
  if (tabular) {
    const t = readTable(parseCsv(text), isSku);
    if (t.rows.length) return { ...t, format: "tableau" };
  }
  return { ...readText(text, isSku), format: "texte" };
}
