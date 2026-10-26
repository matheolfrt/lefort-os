// CSV in the format French Excel expects: semicolon separator, comma decimals, UTF-8 with BOM.
// The parser also accepts comma or tab separated files (Google Sheets, Numbers, other tools).

export type Cell = string | number | null | undefined;

const quote = (v: Cell) => {
  const s = v == null ? "" : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Cell[][]): string {
  return "﻿" + rows.map((r) => r.map(quote).join(";")).join("\r\n");
}

/** 4550 → "45,50" */
export const csvEuros = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/** "45,50" / "45.5" / "45 €" → 4550; empty → null; invalid → NaN */
export function parseCsvEuros(v: string | undefined): number | null {
  const s = (v ?? "").replace(/\s|€/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "Prix minimum (€)" → "prix_minimum" — lets people keep their own column titles */
export const headerKey = (h: string) =>
  h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)/g, "").trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Turns rows into objects keyed by canonical field names, using header aliases */
export function mapRows(rows: string[][], aliases: Record<string, string[]>): { records: Record<string, string>[]; unknown: string[] } {
  const [head = [], ...body] = rows;
  const lookup = new Map<string, string>();
  for (const [field, names] of Object.entries(aliases)) for (const n of [field, ...names]) lookup.set(headerKey(n), field);
  const fields = head.map((h) => lookup.get(headerKey(h)) ?? null);
  const unknown = head.filter((_, i) => !fields[i] && head[i].trim());
  const records = body.map((r) => {
    const o: Record<string, string> = {};
    fields.forEach((f, i) => { if (f) o[f] = (r[i] ?? "").trim(); });
    return o;
  });
  return { records, unknown };
}

/** Triggers a browser download of a CSV built client-side (templates, error reports) */
export function downloadCsv(name: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
